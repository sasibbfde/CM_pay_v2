import { NextResponse } from 'next/server';
import { fetchUsers, fetchTimePunches, fetchDepartments, fetchRoles, fetchUserWages, fetchHoursAndWages } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveEmployeeWage, selectHourlyWage, SevenShiftsWage } from '@/lib/wages';
import { calculateBreaks, calculateGrossHours, calculatePayrollHours } from '@/lib/time-punch';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { flattenHoursAndWagesReport, hoursWagesLookup } from '@/lib/hours-wages';

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
  '467000': 'Chiang Mai Mississauga',
  '500371': 'Chiang Mai Mississauga',
};

function mapLoc(id: any): string {
  return LOCATION_MAP[String(id)] || 'Unknown';
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
  for (const e of dbEmps || []) {
    if (e.seven_shifts_user_id) dbEmpMap.set(String(e.seven_shifts_user_id), e);
  }

  // ─── 4. Fetch time punches ────────────────────────────────────────────────
  const startDate = startIso.split('T')[0];
  const endDate   = endIso.split('T')[0];
  const [punchesRes, hoursAndWagesRes] = await Promise.all([
    fetchTimePunches(startIso, endIso),
    fetchHoursAndWages(startDate, endDate).catch((error:any) => ({ error:error.message, data:[] })),
  ]);
  const rawPunches: any[] = punchesRes.data || [];
  const hoursAndWagesEntries = flattenHoursAndWagesReport(hoursAndWagesRes);
  const hoursAndWages = hoursWagesLookup(hoursAndWagesEntries);
  const hoursAndWagesError = 'error' in hoursAndWagesRes ? String(hoursAndWagesRes.error) : '';
  let reportMatchedPunches = 0;

  // ─── 5. Build punch rows with CORRECT break-deducted payroll hours ─────────
  const punchMap = new Map<string, any>();
  const locBreakdown: Record<string, number> = {};

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

    const location   = mapLoc(locId) !== 'Unknown' ? mapLoc(locId) : (dbEmp?.location || 'Unknown');
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
      clocked_in: clockIn,
      location_id: locId,
      location,
    });
    const reportPayrollHours = Number(reportEntry?.regular_hours);
    const reportGrossHours = Number(reportEntry?.gross_hours);
    const reportBreakMinutes = Number(reportEntry?.break_minutes);
    if (reportEntry && Number.isFinite(reportPayrollHours)) reportMatchedPunches += 1;
    const payrollHours = reportEntry && Number.isFinite(reportPayrollHours)
      ? Math.max(0, Math.round(reportPayrollHours * 100) / 100)
      : (clockOut ? calculatePayrollHours(grossHours, unpaidMinutes) : 0);
    const roundedReportGross = Number.isFinite(reportGrossHours) ? Math.round(reportGrossHours * 100) / 100 : 0;
    const finalGrossHours = reportEntry && roundedReportGross > payrollHours + 0.01
      ? roundedReportGross
      : grossHours;
    const finalBreakMinutes = reportEntry && Number.isFinite(reportBreakMinutes) && reportBreakMinutes > 0
      ? Math.max(0, Math.round(reportBreakMinutes))
      : Math.round(breakMinutes);

    if (location && location !== 'Unknown') {
      locBreakdown[location] = (locBreakdown[location] || 0) + payrollHours;
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
      cash_wage: Number(dbEmp?.cash_wage || 0),
      source: '7shifts',
    });
  }

  // ─── 6. Upsert punches ─────────────────────────────────────────────────────
  const punchRows = [...punchMap.values()];
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
    `hours&wages matched ${reportMatchedPunches}/${rawPunches.length} punches`,
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

export async function GET()          { return handleSync({}); }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return handleSync(body);
}
