import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers, fetchLocations, fetchDepartments, fetchRoles } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

const LOCATION_NAME_FIXES: Record<string, string> = {
  'Chiang Mai YorkMills': 'Chiang Mai York Mills',
  'Chiang Mai Yorkmills': 'Chiang Mai York Mills',
  'Chiang Mai SQ1':       'Chiang Mai Mississauga',
  'Chiang Mai Liberty':   'Chiang Mai Liberty Village',
};

const STATIC_LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '467000': 'Chiang Mai Mississauga',
  '500371': 'Chiang Mai Mississauga',
};

const fixLoc  = (n: string) => LOCATION_NAME_FIXES[n] || n;
const fullName = (u: any)   => [(u.first_name||'').trim(),(u.last_name||'').trim()].filter(Boolean).join(' ');

function normalizeWage(v: any): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 200 ? n / 100 : n; // 7shifts sometimes stores cents
}

function computeHours(clockIn: string|null, clockOut: string|null, raw: any): number {
  const rh = Number(raw.hours || raw.total_hours || raw.duration_hours || 0);
  if (rh > 0 && rh < 24) return Math.round(rh * 100) / 100;
  if (clockIn && clockOut) {
    const diff = (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000;
    if (diff > 0 && diff < 24) return Math.round(diff * 100) / 100;
  }
  return 0;
}

export async function GET() { return runSync({}); }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return runSync(body);
}

async function runSync(body: any) {
  const startedAt = Date.now();
  const supabase  = getSupabaseAdmin();

  try {
    const start = body.start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end   = body.end   || new Date().toISOString();

    // ─── 1. Build lookup maps ──────────────────────────────────────────────
    const locationMap = { ...STATIC_LOCATION_MAP };
    try {
      const locs = await fetchLocations();
      for (const loc of locs?.data || []) {
        if (loc.id && loc.name) locationMap[String(loc.id)] = fixLoc(loc.name);
      }
    } catch { /* use static */ }

    const deptMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    try {
      const [depts, roles] = await Promise.all([fetchDepartments(), fetchRoles()]);
      for (const d of depts?.data || []) if (d.id && d.name) deptMap.set(String(d.id), d.name);
      for (const r of roles?.data || []) if (r.id && r.name) roleMap.set(String(r.id), r.name);
    } catch { /* non-fatal */ }

    const mapLoc  = (v: any) => fixLoc(locationMap[String(v||'')] || String(v||'') || 'Unknown');
    const mapDept = (v: any) => deptMap.get(String(v||'')) || String(v||'') || 'Unknown';
    const mapRole = (v: any) => roleMap.get(String(v||'')) || String(v||'') || 'Unknown';

    // ─── 2. Fetch all users ────────────────────────────────────────────────
    const users   = await fetchUsers();
    const userList: any[] = users?.data || [];

    // Dedup by 7shifts ID
    const userById = new Map<string, any>();
    for (const u of userList) userById.set(String(u.id), u);

    // 7shifts user object: wage comes from wage_type + wage fields
    // department/role come from the punch, not the user — so read from
    // punch data later. For now store what's on the user object.
    const userRows = [...userById.values()].map((u: any) => {
      // Wage: 7shifts stores hourly_wage in dollars (not cents)
      const wage = normalizeWage(
        u.hourly_wage ?? u.wage ?? u.base_hourly_rate ?? 0
      );
      // Department: may be on user or role_assignments
      const dept = u.department_name
        || (u.department_id ? mapDept(u.department_id) : null)
        || null; // will be filled from punches later if null
      const role = u.role_name
        || (u.role_id ? mapRole(u.role_id) : null)
        || null;
      const loc  = mapLoc(u.location_id ?? u.home_location_id ?? '');

      return {
        employee_id:          `7S-${u.id}`,
        seven_shifts_user_id: String(u.id),
        first_name:           (u.first_name || '').trim(),
        last_name:            (u.last_name  || '').trim(),
        full_name:            fullName(u),
        location:             loc !== 'Unknown' ? loc : null,
        department:           dept || null,
        role:                 role || null,
        wage,
        active:               Boolean(u.active),
        source:               '7shifts',
        updated_at:           new Date().toISOString(),
      };
    });

    const BATCH = 200;
    for (let i = 0; i < userRows.length; i += BATCH) {
      const { error } = await supabase.from('employees')
        .upsert(userRows.slice(i, i + BATCH), { onConflict: 'seven_shifts_user_id' });
      if (error) throw error;
    }

    // ─── 3. DB name + dept/role fallback ──────────────────────────────────
    const dbEmpMap = new Map<string, { name: string; dept: string; role: string; loc: string }>();
    try {
      const { data: dbEmps } = await supabase.from('employees')
        .select('seven_shifts_user_id, full_name, department, role, location');
      for (const e of dbEmps || []) {
        if (e.seven_shifts_user_id) {
          dbEmpMap.set(String(e.seven_shifts_user_id), {
            name: e.full_name || '',
            dept: e.department || '',
            role: e.role || '',
            loc:  e.location || '',
          });
        }
      }
    } catch { /* non-fatal */ }

    function resolveName(p: any, userId: string): string {
      if (p.employee_name && !/^(User|Staff) \d/.test(p.employee_name)) return p.employee_name;
      if (p.user_name     && !/^(User|Staff) \d/.test(p.user_name))     return p.user_name;
      const live = userById.get(userId);
      if (live) { const n = fullName(live); if (n) return n; }
      const db = dbEmpMap.get(userId);
      if (db?.name) return db.name;
      return `Staff ${userId}`;
    }

    // ─── 4. Fetch all punches ──────────────────────────────────────────────
    let punchesSaved = 0;
    let punchError: string | null = null;
    const locBreakdown: Record<string, number> = {};

    try {
      const punches   = await fetchTimePunches(start, end);
      const punchList: any[] = punches?.data || [];

      // Dedup by punch_id
      const punchMap = new Map<string, any>();
      for (const p of punchList) {
        const userId   = String(p.user_id || p.employee_id || p.user?.id || '');
        const name     = resolveName(p, userId);
        const clockIn  = p.clocked_in  || p.clock_in  || p.start || null;
        const clockOut = p.clocked_out || p.clock_out || p.end   || null;
        const hours    = computeHours(clockIn, clockOut, p);
        const location = fixLoc(
          (typeof p.location_name === 'string' ? p.location_name : null)
          || locationMap[String(p.location_id || p.locationId || '')]
          || String(p.location || '')
          || 'Unknown'
        );
        // dept/role: prefer named fields, fall back to ID lookup
        const dept = p.department_name
          || (p.department_id ? mapDept(p.department_id) : null)
          || p.department || 'Unknown';
        const role = p.role_name
          || (p.role_id ? mapRole(p.role_id) : null)
          || p.role || 'Unknown';
        const punchId  = String(p.id || p.punch_id || `${userId}-${clockIn}`);

        locBreakdown[location] = (locBreakdown[location] || 0) + hours;

        punchMap.set(punchId, {
          punch_id:      punchId,
          employee_id:   userId ? `7S-${userId}` : 'UNKNOWN',
          employee_name: name,
          location,
          department:    dept,
          role,
          clocked_in:    clockIn,
          clocked_out:   clockOut,
          hours,
          wage: normalizeWage(p.hourly_wage || p.wage || userById.get(userId)?.hourly_wage || 0),
          source: '7shifts',
        });
      }

      const punchRows = [...punchMap.values()];
      for (let i = 0; i < punchRows.length; i += BATCH) {
        const { error } = await supabase.from('punches')
          .upsert(punchRows.slice(i, i + BATCH), { onConflict: 'punch_id' });
        if (error) throw error;
      }
      punchesSaved = punchRows.length;

      // Back-fill dept/role/location on employees from their punches
      // (7shifts user API doesn't always return these)
      try {
        await supabase.rpc('backfill_employee_dept_from_punches');
      } catch {
        // function may not exist yet — run inline
        const { data: empRows } = await supabase
          .from('employees')
          .select('employee_id, department, role, location')
          .or('department.is.null,department.eq.Unknown,location.is.null,location.eq.Unknown');

        for (const emp of empRows || []) {
          const { data: lastPunch } = await supabase
            .from('punches')
            .select('department, role, location')
            .eq('employee_id', emp.employee_id)
            .neq('department', 'Unknown')
            .not('department', 'is', null)
            .order('clocked_in', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastPunch) {
            await supabase.from('employees').update({
              department: lastPunch.department,
              role:       lastPunch.role,
              location:   lastPunch.location,
            }).eq('employee_id', emp.employee_id);
          }
        }
      }

    } catch (e: any) {
      punchError = e.message;
    }

    // ─── 5. Write sync log ─────────────────────────────────────────────────
    const duration = Date.now() - startedAt;
    try {
      await supabase.from('sync_log').insert({
        triggered_by:   body.triggered_by || 'manual',
        date_from:      start.split('T')[0],
        date_to:        end.split('T')[0],
        users_synced:   userRows.length,
        punches_synced: punchesSaved,
        errors:         punchError,
        duration_ms:    duration,
        location_breakdown: locBreakdown,
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      synced: { users: userRows.length, punches: punchesSaved },
      duration_ms: duration,
      start, end,
      punch_error: punchError,
    });

  } catch (e: any) {
    try {
      await supabase.from('sync_log').insert({
        triggered_by: body?.triggered_by || 'manual',
        errors: e.message,
        duration_ms: Date.now() - startedAt,
      });
    } catch { /* ignore */ }
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
