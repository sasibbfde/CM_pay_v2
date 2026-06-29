import { NextResponse } from 'next/server';
import { fetchUsers, fetchTimePunches, fetchDepartments, fetchRoles, fetchUserWages } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { selectHourlyWage, SevenShiftsWage } from '@/lib/wages';

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
function calcBreaks(breaks: any[]): { breakMinutes: number; unpaidMinutes: number; paidMinutes: number } {
  let unpaid = 0, paid = 0;
  for (const b of breaks || []) {
    if (!b.in || !b.out) continue;
    const mins = (new Date(b.out).getTime() - new Date(b.in).getTime()) / 60000;
    if (mins <= 0 || mins > 120) continue; // sanity check
    if (b.paid) { paid += mins; } else { unpaid += mins; }
  }
  return { breakMinutes: unpaid + paid, unpaidMinutes: unpaid, paidMinutes: paid };
}

function calcPayrollHours(grossHours: number, unpaidMinutes: number): number {
  const payroll = grossHours - (unpaidMinutes / 60);
  return Math.max(0, Math.round(payroll * 100) / 100);
}

// ─── main sync ───────────────────────────────────────────────────────────────
async function runSync(body: any): Promise<NextResponse> {
  const t0 = Date.now();
  const supabase = getSupabaseAdmin();

  const startIso = body.start || new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().replace(/T.*/, 'T00:00:00.000Z');
  const endIso   = body.end   || new Date().toISOString().replace(/T.*/, 'T23:59:59.999Z');
  const triggeredBy = body.triggered_by || 'manual';

  // ─── 1. Fetch reference data ───────────────────────────────────────────────
  const [usersRes, deptsRes, rolesRes] = await Promise.all([
    fetchUsers(), fetchDepartments(), fetchRoles(),
  ]);

  const userById    = new Map<string, any>((usersRes.data || []).map((u: any) => [String(u.id), u]));
  const deptById    = new Map<string, string>((deptsRes.data || []).map((d: any) => [String(d.id), d.name || '']));
  const roleById    = new Map<string, string>((rolesRes.data || []).map((r: any) => [String(r.id), r.name || '']));

  function mapDept(id: any) { return deptById.get(String(id)) || ''; }
  function mapRole(id: any) { return roleById.get(String(id)) || ''; }

  // 7shifts stores wages in a separate endpoint. Fetch active-user wages in
  // bounded batches to avoid overwhelming the API.
  const wagesByUser = new Map<string, SevenShiftsWage[]>();
  const wageErrors: string[] = [];
  const activeUsers = [...userById.values()].filter((user:any) => user.active !== false);
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
    const wage = selectHourlyWage(wagesByUser.get(String(u.id)) || [], u.role_id);
    const loc  = mapLoc(u.location_id ?? u.home_location_id ?? '');
    const dept = u.department_name || mapDept(u.department_id) || null;
    const role = u.role_name || mapRole(u.role_id) || null;
    return {
      employee_id:          `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name:           (u.first_name || '').trim(),
      last_name:            (u.last_name  || '').trim(),
      full_name:            fullName(u),
      active:               Boolean(u.active),
      source:               '7shifts',
      updated_at:           new Date().toISOString(),
      // Only set these if 7shifts has a real value — never overwrite DB data with null
      ...(wage > 0                    ? { wage }        : {}),
      ...(loc && loc !== 'Unknown'    ? { location: loc }: {}),
      ...(dept                        ? { department: dept }: {}),
      ...(role                        ? { role }        : {}),
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
    .select('employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage');
  const dbEmpMap = new Map<string, any>();
  for (const e of dbEmps || []) {
    if (e.seven_shifts_user_id) dbEmpMap.set(String(e.seven_shifts_user_id), e);
  }

  // ─── 4. Fetch time punches ────────────────────────────────────────────────
  const startDate = startIso.split('T')[0];
  const endDate   = endIso.split('T')[0];
  const punchesRes = await fetchTimePunches(startIso, endIso);
  const rawPunches: any[] = punchesRes.data || [];

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
    const wage = selectHourlyWage(wagesByUser.get(userId) || [], p.role_id, punchDate)
      || Number(dbEmp?.wage || 0);

    // Times
    const clockIn  = p.clocked_in  || p.clock_in  || null;
    const clockOut = p.clocked_out || p.clock_out || null;

    // Gross hours = raw clock diff (no breaks)
    let grossHours = 0;
    if (clockIn && clockOut) {
      grossHours = Math.round((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 36000) / 100;
    }

    // ── CORRECT BREAK CALCULATION ──────────────────────────────────────────
    // 7shifts returns breaks as: p.breaks = [{ in: "...", out: "...", paid: bool }]
    const breaks = Array.isArray(p.breaks) ? p.breaks : [];
    const { unpaidMinutes, breakMinutes } = calcBreaks(breaks);

    // Payroll hours = gross - unpaid breaks (matching 7shifts payroll export exactly)
    const payrollHours = clockOut ? calcPayrollHours(grossHours, unpaidMinutes) : 0;

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
      gross_hours:   grossHours,       // raw clock diff
      break_minutes: Math.round(breakMinutes),    // total break duration (paid + unpaid)
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
  const { error: logError } = await supabase.from('sync_log').insert({ triggered_by: triggeredBy, date_from: startDate, date_to: endDate, users_synced: userRows.length, punches_synced: punchesSynced, duration_ms: duration, location_breakdown: locBreakdown, notes: `breaks parsed from ${rawPunches.filter((p:any)=>p.breaks?.length>0).length} punches` });
  if (logError) throw new Error(`Sync log write failed: ${logError.message}`);

  return NextResponse.json({
    ok: true,
    synced: { users: userRows.length, punches: punchesSynced },
    date_range: `${startDate} to ${endDate}`,
    duration_ms: duration,
    location_breakdown: locBreakdown,
    breaks_found: rawPunches.filter((p: any) => (p.breaks||[]).length > 0).length,
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
