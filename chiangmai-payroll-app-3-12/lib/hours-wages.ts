import { calculateBreaks, calculateGrossHours, calculatePayrollHours } from './time-punch';

type HoursWagesEntry = {
  punch_id?: string;
  user_id?: string;
  employee_name?: string;
  location_id?: string;
  location?: string;
  role?: string;
  shift_details?: string;
  wage?: number;
  date?: string;
  clocked_in?: string;
  clocked_out?: string;
  regular_hours?: number;
  gross_hours?: number;
  break_minutes?: number;
};

type RawPunchSupplementOptions = {
  startDate?: string;
  endDate?: string;
  normalizeLocation: (locationId?: any, locationName?: string | null) => string;
  workDate?: (clockedIn: string) => string;
  locationIdForUser?: (userId: string) => string | undefined;
  employeeNameForUser?: (userId: string) => string | undefined;
  roleNameForId?: (roleId: string) => string | undefined;
  userIdForEntry?: (entry: HoursWagesEntry) => string | undefined;
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

function isAggregateReportRow(value: any) {
  const markers = [
    'label', 'type', 'row_type', 'rowType', 'kind', 'name', 'title',
    'role_name', 'roleName', 'shift_details', 'shiftDetails', 'details',
  ].map(field => String(value?.[field] || '').toLowerCase());
  return markers.some(marker =>
    marker === 'total'
    || marker.includes('weekly total')
    || marker.includes('employee total')
    || marker.includes('grand total')
    || marker.includes('subtotal')
    || marker.includes('no shifts')
    || marker.includes('unpaid break')
    || marker.includes('paid break')
  );
}

function breakNoteMinutes(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const text = [
    'label', 'type', 'row_type', 'rowType', 'kind', 'name', 'title',
    'shift_details', 'shiftDetails', 'details', 'description', 'note',
  ].map(field => String(value?.[field] || '')).join(' ');
  const match = text.match(/\b(?:unpaid|paid)?\s*break\s*-\s*(\d+)\s*min/i);
  return match ? Number(match[1]) : 0;
}

function attachBreakToPreviousEntry(output: HoursWagesEntry[], parent: Partial<HoursWagesEntry>, minutes: number) {
  if (!minutes || minutes <= 0) return;
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const entry = output[index];
    const sameEmployee = !parent.employee_name || !entry.employee_name || keyName(parent.employee_name) === keyName(entry.employee_name);
    const sameLocation = !parent.location && !parent.location_id
      ? true
      : keyLocation(parent.location_id || parent.location) === keyLocation(entry.location_id || entry.location);
    if (!sameEmployee || !sameLocation) continue;
    const existingMinutes = Math.max(0, (Number(entry.gross_hours || 0) - Number(entry.regular_hours || 0)) * 60);
    if (existingMinutes >= minutes - 0.5) {
      entry.break_minutes = Math.max(entry.break_minutes || 0, Math.round(existingMinutes));
      return;
    }
    entry.break_minutes = (entry.break_minutes || 0) + minutes;
    const regular = Number(entry.regular_hours || 0);
    const gross = Number(entry.gross_hours || 0);
    if (gross <= regular) entry.gross_hours = regular + (entry.break_minutes || 0) / 60;
    return;
  }
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
  if (isAggregateReportRow(value)) return null;
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
  const shiftDetails = firstString(value, ['shift_details', 'shiftDetails', 'details', 'description']);
  return {
    punch_id: firstString(value, ['punch_id', 'time_punch_id', 'id']) || firstString(punchObject, ['id', 'punch_id']) || parent.punch_id,
    user_id: firstString(value, ['user_id', 'employee_id']) || firstString(userObject, ['id', 'user_id', 'employee_id']) || parent.user_id,
    employee_name: personName(value) || personName(userObject) || parent.employee_name,
    location_id: firstString(value, ['location_id']) || firstString(locationObject, ['id', 'location_id']) || parent.location_id,
    location: firstString(value, ['location_name']) || firstString(locationObject, ['name']) || parent.location,
    role: firstString(value, ['role_name']) || firstString(roleObject, ['name']) || parent.role,
    ...(shiftDetails ? { shift_details: shiftDetails } : {}),
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
  const directPersonName = personName(value);
  return {
    ...parent,
    user_id: firstString(value, ['user_id', 'employee_id'])
      || firstString(userObject, ['id', 'user_id', 'employee_id'])
      || (directPersonName ? firstString(value, ['id']) : undefined)
      || parent.user_id,
    employee_name: directPersonName || personName(userObject) || parent.employee_name,
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
  attachBreakToPreviousEntry(output, nextParent, breakNoteMinutes(value));
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
    // 7shifts split shifts can share the same employee/date/location/payable
    // hours. Include the report shift details, clock-out, gross hours, and
    // break minutes in the duplicate key so equal-payable split shifts are kept
    // while exact nested duplicates from the report payload are still collapsed.
    const key = [
      entry.punch_id,
      entry.user_id,
      entry.employee_name,
      entry.date,
      entry.clocked_in,
      entry.clocked_out,
      entry.shift_details,
      entry.location_id || entry.location,
      entry.regular_hours,
      entry.gross_hours,
      entry.break_minutes,
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

const reportInstanceKey = (
  userId: string,
  date: string,
  location: string,
  payrollHours: number,
) => `${userId}|${date}|${location}|${payrollHours.toFixed(2)}`;

const reportInstancePrefix = (
  userId: string,
  date: string,
  location: string,
) => `${userId}|${date}|${location}|`;

const PAYROLL_HOURS_MATCH_TOLERANCE = 0.03;
const MIN_EQUAL_SPLIT_SUPPLEMENT_HOURS = 3;

function nearbyReportKeys(
  counts: Map<string, number>,
  userId: string,
  date: string,
  location: string,
  payrollHours: number,
) {
  const prefix = reportInstancePrefix(userId, date, location);
  return [...counts.keys()]
    .filter(key => {
      if (!key.startsWith(prefix)) return false;
      const candidateHours = Number(key.slice(prefix.length));
      return Number.isFinite(candidateHours)
        && Math.abs(candidateHours - payrollHours) <= PAYROLL_HOURS_MATCH_TOLERANCE;
    })
    .sort((a, b) => {
      const aHours = Number(a.slice(prefix.length));
      const bHours = Number(b.slice(prefix.length));
      return Math.abs(aHours - payrollHours) - Math.abs(bHours - payrollHours);
    });
}

function takeReportInstance(
  counts: Map<string, number>,
  userId: string,
  date: string,
  location: string,
  payrollHours: number,
) {
  const exact = reportInstanceKey(userId, date, location, payrollHours);
  const exactRemaining = counts.get(exact) || 0;
  if (exactRemaining > 0) {
    counts.set(exact, exactRemaining - 1);
    return true;
  }
  for (const key of nearbyReportKeys(counts, userId, date, location, payrollHours)) {
    const remaining = counts.get(key) || 0;
    if (remaining <= 0) continue;
    counts.set(key, remaining - 1);
    return true;
  }
  return false;
}

function reportInstanceCountNear(
  counts: Map<string, number>,
  userId: string,
  date: string,
  location: string,
  payrollHours: number,
) {
  return nearbyReportKeys(counts, userId, date, location, payrollHours)
    .reduce((sum, key) => sum + (counts.get(key) || 0), 0);
}

/**
 * 7shifts' Hours & Wages API can collapse one half of a same-day double shift
 * when both halves have identical payable hours. The raw time-punch API still
 * contains both punches. Keep the report as the authority, but supplement only
 * the extra raw instances for employee/date/location/payable-hour keys that are
 * already present in the report.
 */
export function supplementEqualPayableSplitPunches(
  entries: HoursWagesEntry[],
  rawPunches: any[],
  options: RawPunchSupplementOptions,
) {
  const remainingReportCounts = new Map<string, number>();
  const originalReportCounts = new Map<string, number>();
  const addReportCount = (key: string) => {
    remainingReportCounts.set(key, (remainingReportCounts.get(key) || 0) + 1);
    originalReportCounts.set(key, (originalReportCounts.get(key) || 0) + 1);
  };

  for (const entry of entries) {
    const userId = options.userIdForEntry?.(entry) || entry.user_id || '';
    const date = entry.date || (entry.clocked_in ? String(entry.clocked_in).slice(0, 10) : '');
    const location = options.normalizeLocation(entry.location_id, entry.location);
    const payrollHours = Number(entry.regular_hours);
    if (!userId || !date || !location || location === 'Unknown' || !Number.isFinite(payrollHours)) continue;
    addReportCount(reportInstanceKey(String(userId), date, location, payrollHours));
  }

  const supplements: HoursWagesEntry[] = [];
  const sortedRawPunches = [...(rawPunches || [])].sort((a, b) =>
    String(a?.clocked_in || a?.clock_in || '').localeCompare(String(b?.clocked_in || b?.clock_in || '')),
  );
  const rawInstanceCounts = new Map<string, number>();

  for (const punch of sortedRawPunches) {
    const clockedIn = punch?.clocked_in || punch?.clock_in || null;
    const clockedOut = punch?.clocked_out || punch?.clock_out || null;
    if (!clockedIn || !clockedOut) continue;
    const userId = String(punch.user_id || punch.userId || '');
    if (!userId) continue;
    const date = options.workDate?.(clockedIn) || String(clockedIn).slice(0, 10);
    if (options.startDate && date < options.startDate) continue;
    if (options.endDate && date > options.endDate) continue;
    const locationId = String(punch.location_id || options.locationIdForUser?.(userId) || '');
    const location = options.normalizeLocation(locationId, undefined);
    if (!location || location === 'Unknown') continue;
    const grossHours = calculateGrossHours(clockedIn, clockedOut);
    if (!grossHours) continue;
    const breakTotals = calculateBreaks(Array.isArray(punch.breaks) ? punch.breaks : []);
    const payrollHours = calculatePayrollHours(grossHours, breakTotals.unpaidMinutes);
    if (payrollHours < MIN_EQUAL_SPLIT_SUPPLEMENT_HOURS) continue;
    const key = reportInstanceKey(userId, date, location, payrollHours);
    rawInstanceCounts.set(key, (rawInstanceCounts.get(key) || 0) + 1);
  }

  for (const punch of sortedRawPunches) {
    const clockedIn = punch?.clocked_in || punch?.clock_in || null;
    const clockedOut = punch?.clocked_out || punch?.clock_out || null;
    if (!clockedIn || !clockedOut) continue;

    const userId = String(punch.user_id || punch.userId || '');
    if (!userId) continue;

    const date = options.workDate?.(clockedIn) || String(clockedIn).slice(0, 10);
    if (options.startDate && date < options.startDate) continue;
    if (options.endDate && date > options.endDate) continue;

    const locationId = String(punch.location_id || options.locationIdForUser?.(userId) || '');
    const location = options.normalizeLocation(locationId, undefined);
    if (!location || location === 'Unknown') continue;

    const grossHours = calculateGrossHours(clockedIn, clockedOut);
    if (!grossHours) continue;

    const breakTotals = calculateBreaks(Array.isArray(punch.breaks) ? punch.breaks : []);
    const payrollHours = calculatePayrollHours(grossHours, breakTotals.unpaidMinutes);
    if (payrollHours < MIN_EQUAL_SPLIT_SUPPLEMENT_HOURS) continue;
    if (takeReportInstance(remainingReportCounts, userId, date, location, payrollHours)) {
      continue;
    }

    // Conservative guard: supplement only extra raw instances for keys the
    // Hours & Wages report already represented at least once.
    const key = reportInstanceKey(userId, date, location, payrollHours);
    const originalCount = reportInstanceCountNear(originalReportCounts, userId, date, location, payrollHours);
    if (originalCount <= 0) continue;
    if ((rawInstanceCounts.get(key) || 0) <= originalCount) continue;

    const roleId = String(punch.role_id || punch.roleId || '');
    supplements.push({
      punch_id: str(punch.id ?? punch.punch_id),
      user_id: userId,
      employee_name: options.employeeNameForUser?.(userId),
      location_id: locationId,
      location,
      role: options.roleNameForId?.(roleId),
      date,
      clocked_in: clockedIn,
      clocked_out: clockedOut,
      regular_hours: payrollHours,
      gross_hours: grossHours,
      break_minutes: Math.round(breakTotals.breakMinutes),
    });
  }

  return {
    entries: supplements.length ? [...entries, ...supplements] : entries,
    supplemented: supplements.length,
    supplements,
  };
}
