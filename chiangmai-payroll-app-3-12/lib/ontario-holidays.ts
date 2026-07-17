const MS_PER_DAY = 86_400_000;

export type OntarioHoliday = {
  date: string;
  name: string;
};

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (nth - 1) * 7);
}

function lastWeekdayBefore(year: number, month: number, day: number, weekday: number) {
  const date = utcDate(year, month, day - 1);
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  return addDays(date, -offset);
}

// Meeus/Jones/Butcher Gregorian Easter algorithm.
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function ontarioPublicHolidays(year: number): OntarioHoliday[] {
  return [
    { date: dateString(year, 1, 1), name: "New Year's Day" },
    { date: toIsoDate(nthWeekdayOfMonth(year, 2, 1, 3)), name: 'Family Day' },
    { date: toIsoDate(addDays(easterSunday(year), -2)), name: 'Good Friday' },
    { date: toIsoDate(lastWeekdayBefore(year, 5, 25, 1)), name: 'Victoria Day' },
    { date: dateString(year, 7, 1), name: 'Canada Day' },
    { date: toIsoDate(nthWeekdayOfMonth(year, 9, 1, 1)), name: 'Labour Day' },
    { date: toIsoDate(nthWeekdayOfMonth(year, 10, 1, 2)), name: 'Thanksgiving Day' },
    { date: dateString(year, 12, 25), name: 'Christmas Day' },
    { date: dateString(year, 12, 26), name: 'Boxing Day' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function ontarioHolidayMapForRange(start: string, end: string) {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const holidays = new Map<string, OntarioHoliday>();
  for (let year = startYear; year <= endYear; year += 1) {
    for (const holiday of ontarioPublicHolidays(year)) {
      if (holiday.date >= start && holiday.date <= end) holidays.set(holiday.date, holiday);
    }
  }
  return holidays;
}

export function ontarioHolidayLabel(start: string, end: string) {
  const holidays = [...ontarioHolidayMapForRange(start, end).values()];
  if (!holidays.length) return 'Holiday';
  return holidays.map(holiday => {
    const date = new Date(`${holiday.date}T12:00:00Z`);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }).join(', ');
}
