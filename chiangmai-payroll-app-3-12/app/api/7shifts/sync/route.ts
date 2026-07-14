import { NextResponse } from 'next/server';
import { fetchUsers, fetchTimePunches, fetchDepartments, fetchRoles, fetchUserWages, fetchHoursAndWages } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveEmployeeWage, selectHourlyWage, SevenShiftsWage } from '@/lib/wages';
import { calculateBreaks, calculateGrossHours, calculatePayrollHours } from '@/lib/time-punch';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { flattenHoursAndWagesReport, hoursWagesLookup } from '@/lib/hours-wages';
import { resolveCashWage } from '@/lib/cash-rates';

export const maxDuration = 300;

// ─── helpers ────────────────────────────────────────────────────────────────
function fullName(u: any): string {
  const f = (u.first_name || '').trim();
  const l = (u.last_name  || '').trim();
  return [f, l].filter(Boolean).join(' ') || `Staff ${u.id}`;
}

const LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  // Current Mississauga location ID. Legacy 467000 now returns 403 from 7shifts.
  '500371': 'Chiang Mai Mississauga',
  // Keep legacy mapping only for old synced rows/punches that may still carry it.
  '467000': 'Chiang Mai Mississauga',
};

const PAYROLL_REPORT_LOCATION_IDS = [
  '450889', // Liberty Village
  '458858', // York Mills
  '461096', // Junction
  '461097', // Danforth
  '464811', // Imm Thai Kitchen
  '465654', // Parklawn
  '500371', // Mississauga
];

function mapLoc(id: any): string {
  return LOCATION_MAP[String(id)] || 'Unknown';
}

const round2 = (value: number) => Math.round(Math.max(0, value) * 100) / 100;
const nameKey = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function normalizeLocation(locationId?: any, locationName?: string | null) {
  const mapped = mapLoc(locationId);
  if (mapped !== 'Unknown') return mapped;
  const raw = (locationName || '').trim();
  if (!raw) return 'Unknown';
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.includes('immthai')) return 'Imm Thai Kitchen';
  if (compact.includes('mississauga')) return 'Chiang Mai Mississauga';
  if (compact.includes('yorkmills') || compact.includes('yorkmill')) return 'Chiang Mai York Mills';
  if (compact.includes('liberty')) return 'Chiang Mai Liberty Village';
  if (compact.includes('junction')) return 'Chiang Mai Junction';
  if (compact.includes('danforth')) return 'Chiang Mai Danforth';
  if (compact.includes('parklawn')) return 'Chiang Mai Parklawn';
  return raw;
}

function reportPunchId(entry: any, index: number) {
  if (entry.punch_id) return `HW-${String(entry.punch_id)}`;
  const stable = [
    entry.user_id || nameKey(entry.employee_name),
    entry.date || String(entry.clocked_in || '').slice(0, 10),
    normalizeLocation(entry.location_id, entry.location),
    entry.clocked_in || '',
    entry.clocked_out || '',
    entry.regular_hours,
    index,
  ].join('|').replace(/[^a-zA-Z0-9|._:-]/g, '');
  return `HW-${stable}`;
}

// ─── break calculation (7shifts payroll method) ──────────────────────────────
/**
 * 7shifts breaks are a `breaks` array on each punch: [{ in, out, paid }]
 * Payroll hours = gross_hours - sum(unpaid break durations)
 * paid=false → deduct from payroll
 * paid=true  → do NOT deduct (employee is paid for that break)
 */
// ─── main sync ───────────────────────────────────────────────────────────────
async function runSync(body: any): Promise<NextResponse> {
  const t0 = Date.now();
  const supabase = getSupabaseAdmin();

  const startIso = body.start || new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().replace(/T.*/, 'T00:00:00.000Z');
  const endIso   = body.end   || new Date().toISOString().replace(/T.*/, 'T23:59:59.999Z');
  const triggeredBy = body.triggered_by || 'manual';
  const shouldSyncWages = body.sync_wages !== false;

  // ─── 1. Fetch reference data ───────────────────────────────────────────────
  const [usersRes, deptsRes, rolesRes] = await Promise.all([
    fetchUsers(), fetchDepartments(), fetchRoles(),
  ]);

  const userById    = new Map<string, any>((usersRes.data || []).map((u: any) => [String(u.id), u]));
  const deptById    = new Map<string, string>((deptsRes.data || []).map((d: any) => [String(d.id), d.name || '']));
  const roleById    = new Map<string, string>((rolesRes.data || []).map((r: any) => [String(r.id), r.name || '']));

  function mapDept(id: any) { return deptById.get(String(id)) || ''; }
  function mapRole(id: any) { return roleById.get(String(id)) || ''; }

  // Roster and manually saved wages are authoritative. Load them before the
  // 7shifts upsert so a routine sync cannot replace either cheque or cash rate.
  const { data: existingEmployees, error: existingError } = await supabase
    .from('employees')
    .select('employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage, wage_locked, wage_source');
  if (existingError) throw new Error(`Employee lookup failed: ${existingError.message}`);
  const existingBy7shiftsId = new Map<string, any>();
  for (const employee of existingEmployees || []) {
    if (employee.seven_shifts_user_id) existingBy7shiftsId.set(String(employee.seven_shifts_user_id), employee);
  }

  // If an employee is no longer returned by either the active or inactive
  // 7shifts roster, remove them from all active app views without deleting
  // historical punches or payroll records.
  const staleIds = [...existingBy7shiftsId.keys()].filter(id => !userById.has(id));
  for (let index = 0; index < staleIds.length; index += 200) {
    const { error } = await supabase.from('employees').update({ active:false, updated_at:new Date().toISOString() }).in('seven_shifts_user_id', staleIds.slice(index,index+200));
    if (error) throw new Error(`Inactive employee cleanup failed: ${error.message}`);
  }

  // 7shifts stores wages in a separate endpoint. Fetch active-user wages in
  // bounded batches to avoid overwhelming the API.
  const wagesByUser = new Map<string, SevenShiftsWage[]>();
  const wageErrors: string[] = [];
  const activeUsers = [...userById.values()].filter((user:any) => {
    if (user.active === false) return false;
    const existing = existingBy7shiftsId.get(String(user.id));
    return shouldSyncWages || Number(existing?.wage || 0) <= 0;
  });
  for (let index = 0; index < activeUsers.length; index += 10) {
    await Promise.all(activeUsers.slice(index, index + 10).map(async (user:any) => {
      try {
        const result = await fetchUserWages(user.id);
        wagesByUser.set(String(user.id), result.data || []);
      } catch (error:any) {
        wageErrors.push(`${fullName(user)}: ${error.message}`);
      }
    }));
  }

  // ─── 2. Upsert employees (never overwrite good wage/location with nulls) ───
  const userRows = [...userById.values()].map((u: any) => {
    const existing = existingBy7shiftsId.get(String(u.id));
    const sevenShiftsWage = selectHourlyWage(wagesByUser.get(String(u.id)) || [], u.role_id);
    const wage = resolveEmployeeWage(existing, sevenShiftsWage);
    const loc  = mapLoc(u.location_id ?? u.home_location_id ?? '');
    const dept = u.department_name || mapDept(u.department_id) || null;
    const role = u.role_name || mapRole(u.role_id) || null;
    const completed = fillMissingRosterDetails({
      full_name:fullName(u),
      location:(loc && loc !== 'Unknown' ? loc : existing?.location) || '',
      department:dept || existing?.department || '',
      role:role || existing?.role || '',
      wage,
    });
    const cashWage = resolveCashWage({ name: fullName(u), location: completed.location, cash_wage: existing?.cash_wage });
    return {
      employee_id:          `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name:           (u.first_name || '').trim(),
      last_name:            (u.last_name  || '').trim(),
      full_name:            fullName(u),
      active:               Boolean(u.active),
      source:               '7shifts',
      wage_locked:          Boolean(existing?.wage_locked),
      wage_source:          existing?.wage_locked ? (existing.wage_source || 'manual') : '7shifts',
      updated_at:           new Date().toISOString(),
      // Only set these if 7shifts has a real value — never overwrite DB data with null
      ...(Number(completed.wage||0)>0 ? { wage:completed.wage } : {}),
      ...(Number(cashWage||0)>0 ? { cash_wage:cashWage } : {}),
      ...(completed.location          ? { location:completed.location }: {}),
      ...(completed.department        ? { department:completed.department }: {}),
      ...(completed.role              ? { role:completed.role }: {}),
    };
  });

  const BATCH = 200;
  for (let i = 0; i < userRows.length; i += BATCH) {
    const { error } = await supabase.from('employees')
      .upsert(userRows.slice(i, i + BATCH), { onConflict: 'seven_shifts_user_id', ignoreDuplicates: false });
    if (error) throw new Error(`Employee upsert failed: ${error.message}`);
  }

  // ─── 3. Load DB employee map ───────────────────────────────────────────────
  const { data: dbEmps } = await supabase
    .from('employees')
    .select('employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage, wage_locked, wage_source');
  const dbEmpMap = new Map<string, any>();
  const dbEmpByName = new Map<string, any>();
  for (const e of dbEmps || []) {
    if (e.seven_shifts_user_id) dbEmpMap.set(String(e.seven_shifts_user_id), e);
    if (e.full_name) dbEmpByName.set(nameKey(e.full_name), e);
  }

  // ─── 4. Fetch time punches ────────────────────────────────────────────────
  const startDate = startIso.split('T')[0];
  const endDate   = endIso.split('T')[0];
  const queryStart = new Date(`${startDate}T00:00:00Z`);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const queryEnd = new Date(`${endDate}T23:59:59Z`);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);
  const [punchesRes, ...hoursAndWagesReports] = await Promise.all([
    fetchTimePunches(queryStart.toISOString(), queryEnd.toISOString()),
    ...PAYROLL_REPORT_LOCATION_IDS.map(locationId => fetchHoursAndWages(startDate, endDate, locationId)
      .then(report => ({
        ...report,
        location_id: locationId,
        location_name: mapLoc(locationId),
      }))),
  ]);
  const rawPunches: any[] = punchesRes.data || [];
  const rawPunchById = new Map<string, any>();
  for (const punch of rawPunches) {
    const rawPunchId = punch.id ?? punch.punch_id;
    if (rawPunchId != null && rawPunchId !== '') rawPunchById.set(String(rawPunchId), punch);
  }
  const hoursAndWagesEntries = hoursAndWagesReports.flatMap(report => flattenHoursAndWagesReport(report));
  const hoursAndWages = hoursWagesLookup(hoursAndWagesEntries);
  const hoursAndWagesError = '';
  let reportMatchedPunches = 0;

  // ─── 5. Build punch rows with CORRECT break-deducted payroll hours ─────────
  const punchMap = new Map<string, any>();
  const locBreakdown: Record<string, number> = {};

  const reportRows = hoursAndWagesEntries
    .filter(entry => {
      const payrollHours = Number(entry.regular_hours);
      const grossHours = Number(entry.gross_hours ?? entry.regular_hours);
      const hasPerson = Boolean(entry.user_id || entry.employee_name);
      const hasDate = Boolean(entry.date || entry.clocked_in);
      const hasLocation = Boolean(entry.location_id || entry.location);
      return hasPerson
        && hasDate
        && hasLocation
        && Number.isFinite(payrollHours)
        && payrollHours >= 0
        && Number.isFinite(grossHours)
        && grossHours > 0;
    })
    .sort((a, b) => [
      a.date || String(a.clocked_in || '').slice(0, 10),
      normalizeLocation(a.location_id, a.location),
      a.employee_name || a.user_id || '',
      a.clocked_in || '',
      a.clocked_out || '',
      String(a.regular_hours ?? ''),
    ].join('|').localeCompare([
      b.date || String(b.clocked_in || '').slice(0, 10),
      normalizeLocation(b.location_id, b.location),
      b.employee_name || b.user_id || '',
      b.clocked_in || '',
      b.clocked_out || '',
      String(b.regular_hours ?? ''),
    ].join('|')));

  const usingReportRows = reportRows.length > 0 && !hoursAndWagesError;

  if (usingReportRows) {
    for (const [index, entry] of reportRows.entries()) {
      const userId = entry.user_id ? String(entry.user_id) : '';
      const dbEmp = (userId ? dbEmpMap.get(userId) : undefined) || dbEmpByName.get(nameKey(entry.employee_name));
      const u7 = userId ? userById.get(userId) : undefined;
      const name = dbEmp?.full_name || entry.employee_name || (u7 ? fullName(u7) : null) || `Staff ${userId || index + 1}`;
      const location = normalizeLocation(entry.location_id, entry.location || dbEmp?.location);
      const date = entry.date || String(entry.clocked_in || '').slice(0, 10);
      const rawPunch = entry.punch_id ? rawPunchById.get(String(entry.punch_id)) : undefined;
      const rawClockIn = rawPunch?.clocked_in || rawPunch?.clock_in || null;
      const rawClockOut = rawPunch?.clocked_out || rawPunch?.clock_out || null;
      const clockIn = entry.clocked_in || rawClockIn || `${date}T12:00:00.000Z`;
      const clockOut = entry.clocked_out || rawClockOut || clockIn;
      const payrollHours = round2(Number(entry.regular_hours || 0));
      const reportGrossHours = round2(Number(entry.gross_hours ?? entry.regular_hours ?? 0));
      const rawGrossHours = rawClockOut ? calculateGrossHours(rawClockIn, rawClockOut) : 0;
      const rawBreaks = Array.isArray(rawPunch?.breaks) ? rawPunch.breaks : [];
      const rawBreakTotals = calculateBreaks(rawBreaks);
      const reportBreakMinutes = Number.isFinite(Number(entry.break_minutes))
        ? Math.max(0, Math.round(Number(entry.break_minutes)))
        : Math.max(0, Math.round((reportGrossHours - payrollHours) * 60));
      const breakMinutes = rawBreakTotals.breakMinutes > 0
        ? Math.round(rawBreakTotals.breakMinutes)
        : reportBreakMinutes;
      const grossHours = rawGrossHours > payrollHours + 0.01
        ? rawGrossHours
        : Math.max(reportGrossHours, payrollHours + breakMinutes / 60);
      const wage = resolveEmployeeWage(
        dbEmp,
        Number(entry.wage || 0) || selectHourlyWage(wagesByUser.get(userId) || [], undefined, date),
      );
      const cashWage = resolveCashWage({ name, location, cash_wage: dbEmp?.cash_wage });
      const department = dbEmp?.department || 'Unknown';
      const role = entry.role || dbEmp?.role || 'Unknown';
      const punchId = reportPunchId(entry, index);

      if (location && location !== 'Unknown') {
        locBreakdown[location] = round2((locBreakdown[location] || 0) + payrollHours);
      }

      punchMap.set(punchId, {
        punch_id: punchId,
        employee_id: userId ? `7S-${userId}` : (dbEmp?.employee_id || `HW-${nameKey(name)}`),
        seven_shifts_user_id: userId || dbEmp?.seven_shifts_user_id || null,
        employee_name: name,
        location,
        department,
        role,
        clocked_in: clockIn,
        clocked_out: clockOut,
        hours: payrollHours,
        payroll_hours: payrollHours,
        gross_hours: grossHours,
        break_minutes: breakMinutes,
        wage,
        cash_wage: cashWage,
        source: '7shifts-hours-wages',
      });
    }
    reportMatchedPunches = punchMap.size;
  } else {
    for (const p of rawPunches) {
      const rawPunchId = p.id ?? p.punch_id;
      if (rawPunchId == null || rawPunchId === '') continue;
      const punchId = String(rawPunchId);

      const userId  = String(p.user_id || p.userId || '');
      const dbEmp   = dbEmpMap.get(userId);
      const u7      = userById.get(userId);

      // Name
      const name = dbEmp?.full_name
        || (u7 ? fullName(u7) : null)
        || (p.first_name && p.last_name ? `${p.first_name} ${p.last_name}`.trim() : null)
        || `Staff ${userId}`;

      // Location / dept / role
      const locId  = String(p.location_id  || u7?.location_id  || '');
      const deptId = String(p.department_id || u7?.department_id || '');
      const roleId = String(p.role_id       || u7?.role_id      || '');

      const location   = normalizeLocation(locId, dbEmp?.location);
      const department = mapDept(deptId) || dbEmp?.department || 'Unknown';
      const role       = mapRole(roleId) || dbEmp?.role || 'Unknown';

      // Match the authoritative 7shifts wage by punch role and effective date.
      const punchDate = String(p.clocked_in || p.clock_in || '').slice(0, 10);
      const wage = resolveEmployeeWage(
        dbEmp,
        selectHourlyWage(wagesByUser.get(userId) || [], p.role_id, punchDate),
      );

      // Times
      const clockIn  = p.clocked_in  || p.clock_in  || null;
      const clockOut = p.clocked_out || p.clock_out || null;

      // Gross hours = raw clock diff (no breaks)
      const grossHours = calculateGrossHours(clockIn, clockOut);

      // ── CORRECT BREAK CALCULATION ──────────────────────────────────────────
      // 7shifts returns breaks as: p.breaks = [{ in: "...", out: "...", paid: bool }]
      const breaks = Array.isArray(p.breaks) ? p.breaks : [];
      const { unpaidMinutes, breakMinutes } = calculateBreaks(breaks);

      // Payroll hours = gross - unpaid breaks (matching 7shifts payroll export exactly)
      const reportEntry = hoursAndWages.find({
        punch_id: punchId,
        user_id: userId,
        employee_name: name,
        clocked_in: clockIn,
        location_id: locId,
        location,
      });
      const reportPayrollHours = Number(reportEntry?.regular_hours);
      const reportGrossHours = Number(reportEntry?.gross_hours);
      const reportBreakMinutes = Number(reportEntry?.break_minutes);
      if (reportEntry && Number.isFinite(reportPayrollHours)) reportMatchedPunches += 1;
      const payrollHours = reportEntry && Number.isFinite(reportPayrollHours)
        ? round2(reportPayrollHours)
        : (clockOut ? calculatePayrollHours(grossHours, unpaidMinutes) : 0);
      const cashWage = resolveCashWage({ name, location, cash_wage: dbEmp?.cash_wage });
      const roundedReportGross = Number.isFinite(reportGrossHours) ? round2(reportGrossHours) : 0;
      const finalGrossHours = reportEntry && roundedReportGross > payrollHours + 0.01
        ? roundedReportGross
        : grossHours;
      const finalBreakMinutes = reportEntry && Number.isFinite(reportBreakMinutes) && reportBreakMinutes > 0
        ? Math.max(0, Math.round(reportBreakMinutes))
        : Math.round(breakMinutes);

      if (location && location !== 'Unknown') {
        locBreakdown[location] = round2((locBreakdown[location] || 0) + payrollHours);
      }

      punchMap.set(punchId, {
        punch_id:      punchId,
        employee_id:   userId ? `7S-${userId}` : 'UNKNOWN',
        seven_shifts_user_id: userId || null,
        employee_name: name,
        location,
        department,
        role,
        clocked_in:    clockIn,
        clocked_out:   clockOut,
        hours:         payrollHours,     // hours = payroll hours (break-deducted)
        payroll_hours: payrollHours,     // explicit payroll_hours field
        gross_hours:   finalGrossHours,  // raw clock diff / 7shifts total hours
        break_minutes: finalBreakMinutes, // total break duration (paid + unpaid)
        wage,
        cash_wage: cashWage,
        source: '7shifts',
      });
    }
  }

  // ─── 6. Upsert punches ─────────────────────────────────────────────────────
  const punchRows = [...punchMap.values()];
  if (usingReportRows) {
    // Payroll periods are evaluated by Toronto business date. A local June 30
    // late-night punch can have a July 1 UTC `clocked_in`, so cleanup must use
    // the same one-day safety window as payroll reads. Otherwise stale pre-report
    // rows can survive beside the authoritative Hours & Wages rows and inflate
    // location totals for Junction / Mississauga / York Mills.
    const { error: deleteError } = await supabase
      .from('punches')
      .delete()
      .in('source', ['7shifts', '7shifts-hours-wages'])
      .gte('clocked_in', queryStart.toISOString())
      .lte('clocked_in', queryEnd.toISOString());
    if (deleteError) throw new Error(`Old 7shifts punch cleanup failed: ${deleteError.message}`);
  }
  let punchesSynced = 0;
  for (let i = 0; i < punchRows.length; i += BATCH) {
    const { error } = await supabase.from('punches')
      .upsert(punchRows.slice(i, i + BATCH), { onConflict: 'punch_id' });
    if (error) { throw new Error(`Punch upsert failed: ${error.message}`); }
    else { punchesSynced += punchRows.slice(i, i + BATCH).length; }
  }

  // ─── 7. After-sync: fill location/dept/role/wage from punches for employees ─
  // This runs after every sync so new employees get their metadata filled in
  const { error: fillError } = await supabase.rpc('fill_employee_fields_from_punches');
  if (fillError) throw new Error(`Employee metadata update failed: ${fillError.message}`);

  // ─── 8. Log sync ───────────────────────────────────────────────────────────
  const duration = Date.now() - t0;
  const notes = [
    `breaks parsed from ${rawPunches.filter((p:any)=>p.breaks?.length>0).length} punches`,
    usingReportRows
      ? `hours&wages authoritative rows ${punchRows.length}/${hoursAndWagesEntries.length}`
      : `hours&wages rows ${hoursAndWagesEntries.length}, matched ${reportMatchedPunches}/${rawPunches.length} punches`,
    hoursAndWagesError ? `hours&wages fallback: ${hoursAndWagesError}` : '',
  ].filter(Boolean).join(' · ');
  const { error: logError } = await supabase.from('sync_log').insert({ triggered_by: triggeredBy, date_from: startDate, date_to: endDate, users_synced: userRows.length, punches_synced: punchesSynced, duration_ms: duration, location_breakdown: locBreakdown, notes });
  if (logError) throw new Error(`Sync log write failed: ${logError.message}`);

  return NextResponse.json({
    ok: true,
    synced: { users: userRows.length, punches: punchesSynced },
    date_range: `${startDate} to ${endDate}`,
    duration_ms: duration,
    location_breakdown: locBreakdown,
    breaks_found: rawPunches.filter((p: any) => (p.breaks||[]).length > 0).length,
    hours_and_wages_matched: reportMatchedPunches,
    hours_and_wages_rows: hoursAndWagesEntries.length,
    hours_and_wages_authoritative: usingReportRows,
    hours_and_wages_error: hoursAndWagesError || undefined,
    wages_synced: wagesByUser.size,
    wage_errors: wageErrors.length ? wageErrors : undefined,
  });
}

async function handleSync(body: any) {
  try {
    return await runSync(body);
  } catch (error: any) {
    return NextResponse.json({ ok:false, error:error.message || '7shifts sync failed' }, { status:500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return handleSync({
    start: url.searchParams.get('start') || undefined,
    end: url.searchParams.get('end') || undefined,
    triggered_by: url.searchParams.get('triggered_by') || undefined,
    sync_wages: url.searchParams.get('sync_wages') === 'false' ? false : undefined,
  });
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return handleSync(body);
}
