import { calculateBreaks } from './time-punch';

type HoursWagesEntry = {
  punch_id?: string;
  user_id?: string;
  employee_name?: string;
  location_id?: string;
  location?: string;
  role?: string;
  wage?: number;
  date?: string;
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
const keyName = (value?: string) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function nameKeys(value?: string) {
  const raw = (value || '').trim();
  if (!raw) return [];
  const keys = new Set<string>([keyName(raw)]);
  const comma = raw.split(',').map(part => part.trim()).filter(Boolean);
  if (comma.length >= 2) {
    keys.add(keyName(`${comma.slice(1).join(' ')} ${comma[0]}`));
  }
  return [...keys].filter(Boolean);
}

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

function personName(value: any) {
  const direct = firstString(value, [
    'employee_name', 'employeeName', 'user_name', 'userName', 'staff_name',
    'staffName', 'name', 'full_name', 'fullName',
  ]);
  if (direct) return direct;
  const first = firstString(value, ['first_name', 'firstName', 'firstname']);
  const last = firstString(value, ['last_name', 'lastName', 'lastname']);
  return [first, last].filter(Boolean).join(' ') || undefined;
}

function workDate(value: any, clockedIn?: string) {
  const date = firstString(value, [
    'date', 'work_date', 'worked_date', 'business_date', 'shift_date', 'day',
  ]);
  if (date) return date.slice(0, 10);
  return clockedIn ? String(clockedIn).slice(0, 10) : undefined;
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
    employee_name: personName(value) || personName(userObject) || parent.employee_name,
    location_id: firstString(value, ['location_id']) || firstString(locationObject, ['id', 'location_id']) || parent.location_id,
    location: firstString(value, ['location_name']) || firstString(locationObject, ['name']) || parent.location,
    role: firstString(value, ['role_name']) || firstString(roleObject, ['name']) || parent.role,
    wage: firstNumber(value, ['wage', 'hourly_wage', 'rate', 'hourly_rate']) ?? parent.wage,
    date: workDate(value, clockedIn) || parent.date,
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
    employee_name: personName(value) || personName(userObject) || parent.employee_name,
    location_id: firstString(value, ['location_id']) || firstString(locationObject, ['id', 'location_id']) || parent.location_id,
    location: firstString(value, ['location_name']) || firstString(locationObject, ['name']) || parent.location,
    role: firstString(value, ['role_name']) || firstString(roleObject, ['name']) || parent.role,
    wage: firstNumber(value, ['wage', 'hourly_wage', 'rate', 'hourly_rate']) ?? parent.wage,
    date: workDate(value) || parent.date,
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
  const parent = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? childParent(payload, {})
    : {};
  walk(payload?.data ?? payload, parent, output);
  const seen = new Set<string>();
  return output.filter(entry => {
    const key = [
      entry.punch_id,
      entry.user_id,
      entry.employee_name,
      entry.date,
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
  const byNameDateLocation = new Map<string, HoursWagesEntry[]>();
  const push = (map: Map<string, HoursWagesEntry[]>, key: string, entry: HoursWagesEntry) => {
    map.set(key, [...(map.get(key) || []), entry]);
  };
  for (const entry of entries) {
    if (entry.punch_id) byPunchId.set(String(entry.punch_id), entry);
    const date = entry.date || (entry.clocked_in ? String(entry.clocked_in).slice(0, 10) : undefined);
    const location = entry.location_id || keyLocation(entry.location);
    if (entry.user_id && date) {
      push(byFallback, `${entry.user_id}|${date}|${location}`, entry);
    }
    if (entry.employee_name && date) {
      for (const name of nameKeys(entry.employee_name)) {
        push(byNameDateLocation, `${name}|${date}|${location}`, entry);
      }
    }
  }
  return {
    find(punch: { punch_id?: string; user_id?: string; employee_name?: string; clocked_in?: string | null; location_id?: string; location?: string }) {
      if (punch.punch_id && byPunchId.has(String(punch.punch_id))) return byPunchId.get(String(punch.punch_id));
      if (!punch.clocked_in) return undefined;
      const date = String(punch.clocked_in).slice(0, 10);
      const locations = [punch.location_id, keyLocation(punch.location), ''].filter((item, index, all) => item !== undefined && all.indexOf(item) === index);
      if (punch.user_id) {
        for (const location of locations) {
          const queue = byFallback.get(`${punch.user_id}|${date}|${location}`);
          const entry = queue?.shift();
          if (entry) return entry;
        }
      }
      for (const name of nameKeys(punch.employee_name)) {
        for (const location of locations) {
          const queue = byNameDateLocation.get(`${name}|${date}|${location}`);
          const entry = queue?.shift();
          if (entry) return entry;
        }
      }
      return undefined;
    },
  };
}
