import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPayrollDate } from '@/lib/payroll';
import { calculateBreaks, calculateGrossHours, calculatePayrollHours } from '@/lib/time-punch';

export const maxDuration = 300;

type StoredPunch = {
  id: string;
  punch_id: string | null;
  employee_id: string | null;
  seven_shifts_user_id: string | null;
  employee_name: string | null;
  location: string | null;
  clocked_in: string | null;
  clocked_out: string | null;
  payroll_hours: number | string | null;
  punch_source: string | null;
  source: string | null;
};

const LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '500371': 'Chiang Mai Mississauga',
  '467000': 'Chiang Mai Mississauga',
};

const PAGE = 1000;

function mapLoc(id: any) {
  return LOCATION_MAP[String(id)] || 'Unknown';
}

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

function torontoDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map(part => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function normalizePunchSource(raw: any) {
  const candidates = [
    raw?.pos_type,
    raw?.punch_source,
    raw?.source,
    raw?.source_type,
    raw?.clocked_in_source,
    raw?.clock_in_source,
    raw?.clocked_out_source,
    raw?.clock_out_source,
    raw?.device_type,
    raw?.origin,
    raw?.platform,
  ];
  const value = String(candidates.find(candidate => String(candidate || '').trim()) || '').trim();
  if (!value) return null;
  return value.toLowerCase().includes('web') ? 'web' : '7punches';
}

function rawKey(userId: string, date: string, location: string, payrollHours: number) {
  return `${userId}|${date}|${location}|${payrollHours.toFixed(2)}`;
}

function storedUserId(row: StoredPunch) {
  return String(row.seven_shifts_user_id || row.employee_id || '').replace(/^7S-/, '');
}

function storedPunchMatchesRawId(storedPunchId: string | null, rawPunchId: string) {
  if (!storedPunchId) return false;
  return storedPunchId === rawPunchId || storedPunchId.startsWith(`HW-${rawPunchId}-`);
}

async function fetchStoredPunches(supabase: any, queryStart: string, queryEnd: string) {
  const rows: StoredPunch[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('punches')
      .select('id,punch_id,employee_id,seven_shifts_user_id,employee_name,location,clocked_in,clocked_out,payroll_hours,punch_source,source')
      .gte('clocked_in', queryStart)
      .lte('clocked_in', queryEnd)
      .order('clocked_in', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data || []) as StoredPunch[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get('start') || new Date().toISOString().slice(0, 10);
    const endDate = url.searchParams.get('end') || startDate;
    const dryRun = url.searchParams.get('dry_run') === 'true';
    const queryStart = new Date(`${startDate}T00:00:00.000Z`);
    queryStart.setUTCDate(queryStart.getUTCDate() - 1);
    const queryEnd = new Date(`${endDate}T23:59:59.999Z`);
    queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);

    const [{ data: users }, { data: rawPunches }] = await Promise.all([
      fetchUsers(),
      fetchTimePunches(queryStart.toISOString(), queryEnd.toISOString()),
    ]);
    const userById = new Map<string, any>((users || []).map((user: any) => [String(user.id), user]));
    const rawById = new Map<string, any>();
    const rawByKey = new Map<string, any[]>();

    for (const punch of rawPunches || []) {
      const rawClockIn = punch.clocked_in || punch.clock_in || null;
      const rawClockOut = punch.clocked_out || punch.clock_out || null;
      if (!rawClockIn || !rawClockOut) continue;
      const date = torontoDate(rawClockIn);
      if (!date || date < startDate || date > endDate) continue;
      const source = normalizePunchSource(punch);
      if (!source) continue;
      const punchId = punch.id ?? punch.punch_id;
      if (punchId != null && punchId !== '') rawById.set(String(punchId), punch);
      const userId = String(punch.user_id || punch.userId || '');
      if (!userId) continue;
      const location = normalizeLocation(punch.location_id || userById.get(userId)?.location_id, punch.location);
      const grossHours = calculateGrossHours(rawClockIn, rawClockOut);
      const { unpaidMinutes } = calculateBreaks(Array.isArray(punch.breaks) ? punch.breaks : []);
      const payrollHours = calculatePayrollHours(grossHours, unpaidMinutes);
      for (const dateCandidate of [date, String(rawClockIn).slice(0, 10)].filter((item, index, all) => item && all.indexOf(item) === index)) {
        const key = rawKey(userId, dateCandidate, location, payrollHours);
        rawByKey.set(key, [...(rawByKey.get(key) || []), punch]);
      }
    }

    const supabase = getSupabaseAdmin();
    const storedRows = (await fetchStoredPunches(supabase, queryStart.toISOString(), queryEnd.toISOString()))
      .filter(row => {
        const date = getPayrollDate(row.clocked_in || '');
        return date >= startDate && date <= endDate;
      });

    const updates: Array<{ id: string; old_source: string | null; new_source: string; employee_name: string | null; date: string; location: string | null }> = [];
    for (const row of storedRows) {
      if (!row.id || !row.clocked_in) continue;
      const existing = normalizePunchSource({ source: row.punch_source });
      let rawMatch: any | undefined;
      for (const [rawId, punch] of rawById.entries()) {
        if (storedPunchMatchesRawId(row.punch_id, rawId)) {
          rawMatch = punch;
          break;
        }
      }
      if (!rawMatch) {
        const userId = storedUserId(row);
        const location = normalizeLocation(undefined, row.location);
        const payrollHours = Number(row.payroll_hours || 0);
        const key = rawKey(userId, getPayrollDate(row.clocked_in), location, payrollHours);
        const queue = rawByKey.get(key);
        rawMatch = queue?.shift();
      }
      const nextSource = normalizePunchSource(rawMatch);
      if (!nextSource || nextSource === existing) continue;
      updates.push({
        id: row.id,
        old_source: row.punch_source,
        new_source: nextSource,
        employee_name: row.employee_name,
        date: getPayrollDate(row.clocked_in),
        location: row.location,
      });
    }

    if (!dryRun) {
      for (const update of updates) {
        const { error } = await supabase
          .from('punches')
          .update({ punch_source: update.new_source })
          .eq('id', update.id);
        if (error) throw error;
      }
      if (updates.length) {
        await supabase.from('sync_log').insert({
          triggered_by: 'punch-source-repair',
          date_from: startDate,
          date_to: endDate,
          users_synced: 0,
          punches_synced: updates.length,
          duration_ms: 0,
          notes: 'Updated punch_source only from raw 7shifts punches. Payroll hours, breaks, wages, and pay were not changed.',
        });
      }
    }

    const bySource = updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.new_source] = (acc[update.new_source] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      range: { start: startDate, end: endDate },
      stored_punches_checked: storedRows.length,
      raw_punches_checked: rawById.size,
      updates: updates.length,
      by_source: bySource,
      sample: updates.slice(0, 25),
      payroll_values_changed: false,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Punch source repair failed' }, { status: 500 });
  }
}
