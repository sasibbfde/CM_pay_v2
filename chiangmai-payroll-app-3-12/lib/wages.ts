export type SevenShiftsWage = {
  effective_date?: string;
  role_id?: number | string | null;
  wage_type?: 'hourly' | 'weekly_salary' | string;
  wage_cents?: number | string;
};

type StoredWage = { wage?: number | string | null; wage_locked?: boolean } | null | undefined;

const money = (value: number) => `$${value.toFixed(2)}`;
const numeric = (value: number | string | null | undefined) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function resolveEmployeeWage(existing: StoredWage, sevenShiftsWage: number) {
  const stored = numeric(existing?.wage);
  const apiWage = numeric(sevenShiftsWage);
  if (apiWage <= 0) return stored;
  // Payroll safety rule: never downgrade a saved/manual wage, but always
  // accept a higher hourly wage from 7shifts so the app cannot underpay.
  return Math.max(stored, apiWage);
}

export function shouldUpgradeEmployeeWage(existing: StoredWage, sevenShiftsWage: number) {
  const stored = numeric(existing?.wage);
  const apiWage = numeric(sevenShiftsWage);
  return stored > 0 && apiWage > stored + 0.004;
}

export function wageUpgradeNote(oldWage: number, newWage: number, changedAt = new Date()) {
  const date = changedAt.toISOString().slice(0, 10);
  return `Wage upgraded from ${money(oldWage)} to ${money(newWage)} from 7shifts on ${date}`;
}

const toDate = (value?: string) => value || '0000-00-00';

export function selectHourlyWage(
  wages: SevenShiftsWage[],
  roleId?: number | string | null,
  onDate = new Date().toISOString().slice(0, 10),
) {
  const eligible = wages
    .filter(wage => wage.wage_type === 'hourly' && toDate(wage.effective_date) <= onDate)
    .sort((a, b) => toDate(b.effective_date).localeCompare(toDate(a.effective_date)));
  const role = roleId == null ? null : String(roleId);
  const match = eligible.find(wage => role !== null && wage.role_id != null && String(wage.role_id) === role)
    || eligible.find(wage => wage.role_id == null)
    || eligible[0];
  if (!match) return 0;
  const cents = Number(match.wage_cents || 0);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) / 100 : 0;
}
