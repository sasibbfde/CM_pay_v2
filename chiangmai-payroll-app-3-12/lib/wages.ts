export type SevenShiftsWage = {
  effective_date?: string;
  role_id?: number | string | null;
  wage_type?: 'hourly' | 'weekly_salary' | string;
  wage_cents?: number | string;
};

type StoredWage = { wage?: number | string | null; wage_locked?: boolean } | null | undefined;

export function resolveEmployeeWage(existing: StoredWage, sevenShiftsWage: number) {
  const stored = Number(existing?.wage || 0);
  if (existing?.wage_locked) return Number.isFinite(stored) ? stored : 0;
  return sevenShiftsWage > 0 ? sevenShiftsWage : (Number.isFinite(stored) ? stored : 0);
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
