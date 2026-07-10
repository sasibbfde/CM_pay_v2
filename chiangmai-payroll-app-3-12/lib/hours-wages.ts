import { calculateBreaks } from './time-punch';

type HoursWagesEntry = {
  punch_id?: string;
  user_id?: string;
  location_id?: string;
  location?: string;
  role?: string;
  wage?: number;
  clocked_in?: string;
  clocked_out?: string;
  regular_hours?: number;
  gross_hours?: number;
  break_minutes?: number;
};

const num = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const str = (value: any) => value == null || value === '' ? undefined : String(value);
const keyLocation = (value?: string) => (value || '')
  .toLowerCase()
  .replace(/york\s*mills/g, 'yorkmills')
  .replace(/village/g, '')
  .replace(/[^a-z0-9]/g, '');

function firstNumber(source: any, names: string[]) {
  for (const name of names) {
    const value = num(source?.[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(source: any, names: string[]) {
  for (const name of names) {
    const value = str(source?.[name]);
    if (value) return value;
  }
  return undefined;
}

function clockTime(value: any) {
  return firstString(value, [
    'clocked_in', 'clocked_in_datetime', 'clock_in', 'clockin', 'start',
    'start_time', 'shift_start', 'in',
  ]);
}

function clockOutTime(value: any) {
  return firstString(value, [
    'clocked_out', 'clocked_out_datetime', 'clock_out', 'clockout', 'end',
    'end_time', 'shift_end', 'out',
  ]);
}

function breakMinutes(value: any, grossHours?: number, regularHours?: number) {
  const direct = firstNumber(value, ['break_minutes', 'breaks_minutes', 'unpaid_break_minutes']);
  if (direct !== undefined) return direct;
  const breakHours = firstNumber(value, ['break_hours', 'unpaid_break_hours']);
  if (breakHours !== undefined) return breakHours * 60;
  const breaks = Array.isArray(value?.breaks) ? value.breaks : [];
  if (breaks.length) return calculateBreaks(breaks).breakMinutes;
  if (grossHours !== undefined && regularHours !== undefined) {
    return Math.max(0, (grossHours - regularHours) * 60);
  }
  return undefined;
}

function entryFromObject(value: any, parent: Partial<HoursWagesEntry>): HoursWagesEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const regular = firstNumber(value, [
    'regular_hours', 'regularHours', 'payroll_hours', 'payable_hours',
    'paid_hours', 'hours_regular',
  ]);
  const gross = firstNumber(value, [
    'total_hours', 'totalHours', 'gross_hours', 'actual_hours', 'hours',
  ]);
  if (regular === undefined && gross === undefined) return null;

  const locationObject = value.location || value.location_data || {};
  const roleObject = value.role || value.job || {};
  const userObject = value.user || value.employee || value.staff || {};
  const punchObject = value.punch || value.time_punch || {};
  const clockedIn = clockTime(value) || clockTime(punchObject);
  const clockedOut = clockOutTime(value) || clockOutTime(punchObject);
  const regularHours = regular ?? gross ?? 0;
  const grossHours = gross ?? regularHours;
  return {
    punch_id: firstString(value, ['punch_id', 'time_punch_id', 'id']) || firstString(punchObject, ['id', 'punch_id']) || parent.punch_id,
    user_id: firstString(value, ['user_id', 'employee_id']) || firstString(userObject, ['id', 'user_id', 'employee_id']) || parent.user_id,
    location_id: firstString(value, ['location_id']) || firstString(locationObject, ['id', 'location_id']) || parent.location_id,
    location: firstString(value, ['location_name']) || firstString(locationObject, ['name']) || parent.location,
    role: firstString(value, ['role_name']) || firstString(roleObject, ['name']) || parent.role,
    wage: firstNumber(value, ['wage', 'hourly_wage', 'rate', 'hourly_rate']) ?? parent.wage,
    clocked_in: clockedIn,
    clocked_out: clockedOut,
    regular_hours: regularHours,
    gross_hours: grossHours,
    break_minutes: breakMinutes(value, grossHours, regularHours),
  };
}

function childParent(value: any, parent: Partial<HoursWagesEntry>) {
  const locationObject = value?.location || value?.location_data || {};
  const userObject = value?.user || value?.employee || value?.staff || {};
  const roleObject = value?.role || value?.job || {};
  return {
    ...parent,
    user_id: firstString(value, ['user_id', 'employee_id']) || firstString(userObject, ['id', 'user_id', 'employee_id']) || parent.user_id,
    location_id: firstString(value, ['location_id']) || firstString(locationObject, ['id', 'location_id']) || parent.location_id,
    location: firstString(value, ['location_name']) || firstString(locationObject, ['name']) || parent.location,
    role: firstString(value, ['role_name']) || firstString(roleObject, ['name']) || parent.role,
    wage: firstNumber(value, ['wage', 'hourly_wage', 'rate', 'hourly_rate']) ?? parent.wage,
  };
}

function walk(value: any, parent: Partial<HoursWagesEntry>, output: HoursWagesEntry[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => walk(item, parent, output));
    return;
  }
  if (typeof value !== 'object') return;
  const nextParent = childParent(value, parent);
  const entry = entryFromObject(value, nextParent);
  if (entry) output.push(entry);
  for (const [key, child] of Object.entries(value)) {
    if (['user', 'employee', 'staff', 'location', 'location_data', 'role', 'job'].includes(key)) continue;
    if (child && typeof child === 'object') walk(child, nextParent, output);
  }
}

export function flattenHoursAndWagesReport(payload: any): HoursWagesEntry[] {
  const output: HoursWagesEntry[] = [];
  walk(payload?.data ?? payload, {}, output);
  const seen = new Set<string>();
  return output.filter(entry => {
    const key = [
      entry.punch_id,
      entry.user_id,
      entry.clocked_in,
      entry.location_id || entry.location,
      entry.regular_hours,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hoursWagesLookup(entries: HoursWagesEntry[]) {
  const byPunchId = new Map<string, HoursWagesEntry>();
  const byFallback = new Map<string, HoursWagesEntry[]>();
  for (const entry of entries) {
    if (entry.punch_id) byPunchId.set(String(entry.punch_id), entry);
    if (!entry.user_id || !entry.clocked_in) continue;
    const date = String(entry.clocked_in).slice(0, 10);
    const location = entry.location_id || keyLocation(entry.location);
    const key = `${entry.user_id}|${date}|${location}`;
    byFallback.set(key, [...(byFallback.get(key) || []), entry]);
  }
  return {
    find(punch: { punch_id?: string; user_id?: string; clocked_in?: string | null; location_id?: string; location?: string }) {
      if (punch.punch_id && byPunchId.has(String(punch.punch_id))) return byPunchId.get(String(punch.punch_id));
      if (!punch.user_id || !punch.clocked_in) return undefined;
      const date = String(punch.clocked_in).slice(0, 10);
      const locations = [punch.location_id, keyLocation(punch.location), ''].filter((item, index, all) => item !== undefined && all.indexOf(item) === index);
      for (const location of locations) {
        const queue = byFallback.get(`${punch.user_id}|${date}|${location}`);
        const entry = queue?.shift();
        if (entry) return entry;
      }
      return undefined;
    },
  };
}
