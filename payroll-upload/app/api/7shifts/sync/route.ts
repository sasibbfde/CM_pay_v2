import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers, fetchLocations, fetchDepartments, fetchRoles } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

// Static location name corrections (applied AFTER the live map)
const LOCATION_NAME_FIXES: Record<string, string> = {
  'Chiang Mai YorkMills':  'Chiang Mai York Mills',
  'Chiang Mai Yorkmills':  'Chiang Mai York Mills',
};

// Static fallback ID → name map
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

function fixLocationName(name: string): string {
  return LOCATION_NAME_FIXES[name] || name;
}

function fullName(u: any): string {
  const first = (u.first_name || '').trim();
  const last  = (u.last_name  || '').trim();
  return [first, last].filter(Boolean).join(' ');
}

function normalizeWage(v: any): number {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 100 ? n / 100 : n; // 7shifts stores cents when > 100
}

export async function GET() {
  return sync7shifts({});
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return sync7shifts(body);
}

async function sync7shifts(body: any) {
  try {
    const start = body.start ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end = body.end || new Date().toISOString();

    const supabase = getSupabaseAdmin();

    // ── 1. Build location map (live + static + name fixes) ─────────────
    let locationMap = { ...STATIC_LOCATION_MAP };
    try {
      const locs = await fetchLocations();
      for (const loc of locs?.data || locs || []) {
        if (loc.id && loc.name) {
          locationMap[String(loc.id)] = fixLocationName(loc.name);
        }
      }
    } catch { /* fall back to static */ }

    function mapLocation(v: any): string {
      const key = String(v || '');
      const name = locationMap[key] || v || 'Unknown';
      return fixLocationName(String(name));
    }

    // ── 2. Build department ID → name map ──────────────────────────────
    const deptMap = new Map<string, string>();
    try {
      const depts = await fetchDepartments();
      for (const d of depts?.data || []) {
        if (d.id && d.name) deptMap.set(String(d.id), d.name);
      }
    } catch { /* non-fatal */ }

    function mapDept(v: any): string {
      const key = String(v || '');
      return deptMap.get(key) || (deptMap.size === 0 ? key : key) || 'Unknown';
    }

    // ── 3. Build role ID → name map ────────────────────────────────────
    const roleMap = new Map<string, string>();
    try {
      const roles = await fetchRoles();
      for (const r of roles?.data || []) {
        if (r.id && r.name) roleMap.set(String(r.id), r.name);
      }
    } catch { /* non-fatal */ }

    function mapRole(v: any): string {
      const key = String(v || '');
      return roleMap.get(key) || key || 'Unknown';
    }

    // ── 4. Fetch ALL employees (paginated) ─────────────────────────────
    const users   = await fetchUsers();
    const userList: any[] = users?.data || [];

    // Dedup by 7shifts ID — keep last occurrence
    const userById = new Map<string, any>();
    for (const u of userList) userById.set(String(u.id), u);

    const userRows = [...userById.values()].map((u: any) => ({
      employee_id:          `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name:           (u.first_name || '').trim(),
      last_name:            (u.last_name  || '').trim(),
      full_name:            fullName(u),
      location:             mapLocation(u.location_id || u.home_location_id),
      department:           u.department_name || mapDept(u.department_id) || 'Unknown',
      role:                 u.role_name       || mapRole(u.role_id)       || 'Unknown',
      wage:                 normalizeWage(u.hourly_wage),
      active:               Boolean(u.active),
      source:               '7shifts',
    }));

    const BATCH = 200;
    for (let i = 0; i < userRows.length; i += BATCH) {
      const { error } = await supabase
        .from('employees')
        .upsert(userRows.slice(i, i + BATCH), { onConflict: 'seven_shifts_user_id' });
      if (error) throw error;
    }

    // ── 5. Load DB name map as fallback for unknown employees ──────────
    const dbNameMap = new Map<string, string>();
    try {
      const { data: dbEmps } = await supabase
        .from('employees')
        .select('seven_shifts_user_id, full_name');
      for (const e of dbEmps || []) {
        if (e.seven_shifts_user_id && e.full_name) {
          dbNameMap.set(String(e.seven_shifts_user_id), e.full_name);
        }
      }
    } catch { /* non-fatal */ }

    function resolveName(p: any, userId: string): string {
      if (p.employee_name && !/^User \d/.test(p.employee_name)) return p.employee_name;
      if (p.user_name     && !/^User \d/.test(p.user_name))     return p.user_name;
      const live = userById.get(userId);
      if (live) { const n = fullName(live); if (n) return n; }
      const db = dbNameMap.get(userId);
      if (db) return db;
      return `Unknown (ID: ${userId || '?'})`;
    }

    // ── 6. Fetch ALL punches (paginated) ───────────────────────────────
    let punchesSaved = 0;
    let punchError: string | null = null;

    try {
      const punches   = await fetchTimePunches(start, end);
      const punchList: any[] = punches?.data || [];

      // Dedup by punch_id
      const punchMap = new Map<string, any>();
      for (const p of punchList) {
        const userId  = String(p.user_id || p.employee_id || p.user?.id || '');
        const name    = resolveName(p, userId);
        const rawWage = p.hourly_wage || p.wage || userById.get(userId)?.hourly_wage || 0;
        const location = mapLocation(p.location_name || p.location || p.location_id || p.locationId);
        const dept     = p.department_name || mapDept(p.department_id || p.department) || 'Unknown';
        const role     = p.role_name       || mapRole(p.role_id || p.role)             || 'Unknown';
        const punchId  = String(p.id || p.punch_id || `${userId}-${p.clocked_in || p.start}`);

        punchMap.set(punchId, {
          punch_id:      punchId,
          employee_id:   userId ? `7S-${userId}` : 'UNKNOWN',
          employee_name: name,
          location,
          department:    dept,
          role,
          clocked_in:    p.clocked_in  || p.clock_in  || p.start || p.punch_in  || null,
          clocked_out:   p.clocked_out || p.clock_out || p.end   || p.punch_out || null,
          hours:         Number(p.hours || p.total_hours || p.duration_hours || 0),
          wage:          normalizeWage(rawWage),
          source:        '7shifts',
        });
      }

      const punchRows = [...punchMap.values()];
      for (let i = 0; i < punchRows.length; i += BATCH) {
        const { error } = await supabase
          .from('punches')
          .upsert(punchRows.slice(i, i + BATCH), { onConflict: 'punch_id' });
        if (error) throw error;
      }
      punchesSaved = punchRows.length;
    } catch (e: any) {
      punchError = e.message;
    }

    return NextResponse.json({
      ok: true,
      source: '7shifts',
      synced: { users: userRows.length, punches: punchesSaved },
      start, end,
      punch_error: punchError,
      location_map: locationMap,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
