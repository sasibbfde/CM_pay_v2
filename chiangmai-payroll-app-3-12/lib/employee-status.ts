const TIME_ZONE = 'America/Toronto';

function torontoParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

export function firstPayrollPeriodEnd(createdAt?: string | null) {
  if (!createdAt) return '';
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) return '';
  const parts = torontoParts(created);
  const year = Number(parts.year); const month = Number(parts.month); const day = Number(parts.day);
  const endDay = day <= 15 ? 15 : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${parts.year}-${parts.month}-${String(endDay).padStart(2,'0')}`;
}

export function isNewEmployee(createdAt?: string | null, now = new Date()) {
  const until = firstPayrollPeriodEnd(createdAt);
  if (!until) return false;
  const current = torontoParts(now);
  return `${current.year}-${current.month}-${current.day}` <= until;
}
