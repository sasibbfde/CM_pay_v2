import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers, fetchLocations } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

// Static fallback map (ID → display name).
const STATIC_LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '467000': 'Chiang Mai Mississauga',
};

function fullName(u: any) {
  const first = (u.first_name || '').trim();
  const last  = (u.last_name  || '').trim();
  if (first && last) return `${first} ${last}`;
  return first || last || '';
}

function normalizeWage(v: any) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  // 7shifts stores wages in cents when value > 100
  return n > 100 ? n / 100 : n;
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
    const start =
      body.start ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end = body.end || new Date().toISOString();

    const supabase = getSupabaseAdmin();

    // ── 1. Build live location map ─────────────────────────────────────
    let locationMap = { ...STATIC_LOCATION_MAP };
    try {
      const locs = await fetchLocations();
      const locList = locs?.data || locs || [];
      for (const loc of locList) {
        if (loc.id && loc.name) locationMap[String(loc.id)] = loc.name;
      }
    } catch {
      // fall back to static map silently
    }

    function mapLocation(v: any): string {
      const key = String(v || '');
      return locationMap[key] || v || 'Unknown';
    }

    // ── 2. Fetch ALL employees (paginated, no 100-limit) ───────────────
    const users    = await fetchUsers();
    const userList: any[] = users?.data || [];

    // Build a fast lookup map: 7shifts user ID → user object
    const userById = new Map<string, any>();
    for (const u of userList) {
      userById.set(String(u.id), u);
    }

    const userRows = userList.map((u: any) => ({
      employee_id:          `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name:           (u.first_name || '').trim(),
      last_name:            (u.last_name  || '').trim(),
      full_name:            fullName(u),
      location:             mapLocation(u.location_id || u.home_location_id),
      department:           u.department_name || u.department || 'Unknown',
      role:                 u.role_name || u.type || 'Unknown',
      wage:                 normalizeWage(u.hourly_wage),
      active:               Boolean(u.active),
      source:               '7shifts',
    }));

    // Upsert in batches of 200 to avoid request size limits
    const BATCH = 200;
    for (let i = 0; i < userRows.length; i += BATCH) {
      const batch = userRows.slice(i, i + BATCH);
      const { error } = await supabase
        .from('employees')
        .upsert(batch, { onConflict: 'seven_shifts_user_id' });
      if (error) throw error;
    }

    // ── 3. Also load existing employees from Supabase as name fallback ─
    // This ensures punches for employees outside the current page still
    // get the right name (e.g. inactive staff who still have old punches).
    let dbNameMap = new Map<string, string>();
    try {
      const { data: dbEmps } = await supabase
        .from('employees')
        .select('seven_shifts_user_id, full_name');
      for (const e of dbEmps || []) {
        if (e.seven_shifts_user_id && e.full_name) {
          dbNameMap.set(String(e.seven_shifts_user_id), e.full_name);
        }
      }
    } catch {
      // non-fatal — live data takes priority anyway
    }

    function resolveName(p: any, userId: string): string {
      // Priority: punch field > live user list > supabase db > fallback
      if (p.employee_name && !p.employee_name.startsWith('User ')) return p.employee_name;
      if (p.user_name     && !p.user_name.startsWith('User '))     return p.user_name;

      const liveUser = userById.get(userId);
      if (liveUser) {
        const name = fullName(liveUser);
        if (name) return name;
      }

      const dbName = dbNameMap.get(userId);
      if (dbName) return dbName;

      return `Unknown (ID: ${userId || '?'})`;
    }

    // ── 4. Fetch ALL time punches (paginated) ─────────────────────────
    let punchesSaved    = 0;
    let punchErrorMsg: string | null = null;

    try {
      const punches   = await fetchTimePunches(start, end);
      const punchList: any[] = punches?.data || [];

      const punchRows = punchList.map((p: any) => {
        const userId = String(p.user_id || p.employee_id || p.user?.id || '');
        const name   = resolveName(p, userId);
        const rawWage = p.hourly_wage || p.wage || userById.get(userId)?.hourly_wage || 0;

        const location = mapLocation(
          p.location_name || p.location || p.location_id || p.locationId
        );

        return {
          punch_id:     String(p.id || p.punch_id || `${userId}-${p.clocked_in || p.start}`),
          employee_id:  userId ? `7S-${userId}` : 'UNKNOWN',
          employee_name: name,
          location,
          department:   String(p.department_name || p.department || p.department_id || 'Unknown'),
          role:         String(p.role_name || p.role || p.role_id || 'Unknown'),
          clocked_in:   p.clocked_in || p.clock_in || p.start  || p.punch_in  || null,
          clocked_out:  p.clocked_out|| p.clock_out|| p.end    || p.punch_out || null,
          hours:        Number(p.hours || p.total_hours || p.duration_hours || 0),
          wage:         normalizeWage(rawWage),
          source:       '7shifts',
        };
      });

      // Upsert punches in batches
      for (let i = 0; i < punchRows.length; i += BATCH) {
        const batch = punchRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from('punches')
          .upsert(batch, { onConflict: 'punch_id' });
        if (error) throw error;
      }

      punchesSaved = punchRows.length;
    } catch (e: any) {
      punchErrorMsg = e.message;
    }

    return NextResponse.json({
      ok: true,
      source: '7shifts',
      synced: { users: userRows.length, punches: punchesSaved },
      start,
      end,
      punch_error: punchErrorMsg,
      location_map: locationMap,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
