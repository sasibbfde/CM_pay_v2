import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers, fetchLocations, fetchDepartments, fetchRoles } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

const LOCATION_NAME_FIXES: Record<string, string> = {
  'Chiang Mai YorkMills': 'Chiang Mai York Mills',
  'Chiang Mai Yorkmills': 'Chiang Mai York Mills',
  'Chiang Mai SQ1':       'Chiang Mai Mississauga',
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

const fixName = (n: string) => LOCATION_NAME_FIXES[n] || n;

function fullName(u: any): string {
  const f = (u.first_name || '').trim();
  const l = (u.last_name  || '').trim();
  return [f, l].filter(Boolean).join(' ');
}

function normalizeWage(v: any): number {
  const n = Number(v || 0);
  return (!Number.isFinite(n)) ? 0 : n > 100 ? n / 100 : n;
}

function computeHours(clockIn: string | null, clockOut: string | null, raw: any): number {
  // Prefer explicit hours field if > 0
  const rawHours = Number(raw.hours || raw.total_hours || raw.duration_hours || 0);
  if (rawHours > 0) return rawHours;
  // Compute from timestamps
  if (clockIn && clockOut) {
    const diff = (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000;
    if (diff > 0 && diff < 24) return Math.round(diff * 100) / 100;
  }
  return 0;
}

export async function GET() { return sync7shifts({}); }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return sync7shifts(body);
}

async function sync7shifts(body: any) {
  const startedAt = Date.now();
  try {
    const start = body.start ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end   = body.end || new Date().toISOString();
    const supabase = getSupabaseAdmin();

    // ── Location map ───────────────────────────────────────────────
    const locationMap = { ...STATIC_LOCATION_MAP };
    try {
      const locs = await fetchLocations();
      for (const loc of locs?.data || locs || []) {
        if (loc.id && loc.name) locationMap[String(loc.id)] = fixName(loc.name);
      }
    } catch { /* use static */ }

    function mapLoc(v: any): string {
      const key = String(v || '');
      return fixName(locationMap[key] || v || 'Unknown');
    }

    // ── Department & Role maps ──────────────────────────────────────
    const deptMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    try {
      const [depts, roles] = await Promise.all([fetchDepartments(), fetchRoles()]);
      for (const d of depts?.data || []) if (d.id && d.name) deptMap.set(String(d.id), d.name);
      for (const r of roles?.data || []) if (r.id && r.name) roleMap.set(String(r.id), r.name);
    } catch { /* non-fatal */ }

    const mapDept = (v: any) => deptMap.get(String(v || '')) || String(v || '') || 'Unknown';
    const mapRole = (v: any) => roleMap.get(String(v || '')) || String(v || '') || 'Unknown';

    // ── Fetch ALL employees (active + inactive) ─────────────────────
    const users    = await fetchUsers();
    const userList: any[] = users?.data || [];
    const userById = new Map<string, any>();
    for (const u of userList) userById.set(String(u.id), u);

    const userRows = [...userById.values()].map((u: any) => ({
      employee_id:          `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name:           (u.first_name || '').trim(),
      last_name:            (u.last_name  || '').trim(),
      full_name:            fullName(u),
      location:             mapLoc(u.location_id || u.home_location_id),
      department:           u.department_name || mapDept(u.department_id) || 'Unknown',
      role:                 u.role_name       || mapRole(u.role_id)       || 'Unknown',
      wage:                 normalizeWage(u.hourly_wage),
      active:               Boolean(u.active),
      source:               '7shifts',
    }));

    const BATCH = 200;
    for (let i = 0; i < userRows.length; i += BATCH) {
      const { error } = await supabase.from('employees')
        .upsert(userRows.slice(i, i + BATCH), { onConflict: 'seven_shifts_user_id' });
      if (error) throw error;
    }

    // ── DB name fallback map ────────────────────────────────────────
    const dbNameMap = new Map<string, string>();
    try {
      const { data: dbEmps } = await supabase.from('employees')
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

    // ── Fetch ALL punches ──────────────────────────────────────────
    let punchesSaved = 0;
    let punchError: string | null = null;
    let unknownBefore = 0;
    let unknownAfter  = 0;
    const locBreakdown: Record<string, number> = {};

    try {
      // Count unknowns before sync
      const { count: ubCount } = await supabase.from('punches')
        .select('*', { count: 'exact', head: true })
        .like('employee_name', 'Unknown (ID:%');
      unknownBefore = ubCount ?? 0;

      const punches   = await fetchTimePunches(start, end);
      const punchList: any[] = punches?.data || [];

      const punchMap = new Map<string, any>();
      for (const p of punchList) {
        const userId  = String(p.user_id || p.employee_id || p.user?.id || '');
        const name    = resolveName(p, userId);
        const clockIn  = p.clocked_in  || p.clock_in  || p.start || p.punch_in  || null;
        const clockOut = p.clocked_out || p.clock_out || p.end   || p.punch_out || null;
        const hours    = computeHours(clockIn, clockOut, p);
        const location = mapLoc(p.location_name || p.location || p.location_id || p.locationId);
        const punchId  = String(p.id || p.punch_id || `${userId}-${clockIn}`);

        locBreakdown[location] = (locBreakdown[location] || 0) + hours;

        punchMap.set(punchId, {
          punch_id:      punchId,
          employee_id:   userId ? `7S-${userId}` : 'UNKNOWN',
          employee_name: name,
          location,
          department:    p.department_name || mapDept(p.department_id || p.department) || 'Unknown',
          role:          p.role_name       || mapRole(p.role_id || p.role)             || 'Unknown',
          clocked_in:    clockIn,
          clocked_out:   clockOut,
          hours,
          wage:          normalizeWage(p.hourly_wage || p.wage || userById.get(userId)?.hourly_wage || 0),
          source:        '7shifts',
        });
      }

      const punchRows = [...punchMap.values()];
      for (let i = 0; i < punchRows.length; i += BATCH) {
        const { error } = await supabase.from('punches')
          .upsert(punchRows.slice(i, i + BATCH), { onConflict: 'punch_id' });
        if (error) throw error;
      }
      punchesSaved = punchRows.length;

      // Count unknowns after sync
      const { count: uaCount } = await supabase.from('punches')
        .select('*', { count: 'exact', head: true })
        .like('employee_name', 'Unknown (ID:%');
      unknownAfter = uaCount ?? 0;

    } catch (e: any) {
      punchError = e.message;
    }

    // ── Write to sync_log ──────────────────────────────────────────
    const duration = Date.now() - startedAt;
    try {
      await supabase.from('sync_log').insert({
        triggered_by:          body.triggered_by || 'manual',
        date_from:             start.split('T')[0],
        date_to:               end.split('T')[0],
        users_synced:          userRows.length,
        punches_synced:        punchesSaved,
        unknown_names_before:  unknownBefore,
        unknown_names_after:   unknownAfter,
        errors:                punchError,
        duration_ms:           duration,
        location_breakdown:    locBreakdown,
        notes:                 body.notes || null,
      });
    } catch { /* log write failure is non-fatal */ }

    return NextResponse.json({
      ok: true,
      synced: { users: userRows.length, punches: punchesSaved },
      unknown_names: { before: unknownBefore, after: unknownAfter },
      duration_ms: duration,
      start, end,
      punch_error: punchError,
    });

  } catch (e: any) {
    // Still try to log the error
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('sync_log').insert({
        triggered_by: body?.triggered_by || 'manual',
        errors: e.message,
        duration_ms: Date.now() - startedAt,
      });
    } catch { /* ignore */ }
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
