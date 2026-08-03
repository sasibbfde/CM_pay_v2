import type { SevenShiftsWage } from '@/lib/wages';

export type WageHistoryEmployee = {
  employee_id?: string | null;
  seven_shifts_user_id?: string | null;
  full_name?: string | null;
  location?: string | null;
  department?: string | null;
  role?: string | null;
  role_id?: string | number | null;
  wage?: number | string | null;
};

export type WageHistoryRow = {
  employee_id: string;
  seven_shifts_user_id: string | null;
  employee_name: string;
  location: string | null;
  department: string | null;
  role: string | null;
  role_id: string | null;
  old_wage: number;
  new_wage: number;
  effective_date: string | null;
  detected_at: string;
  source: '7shifts_user_wages' | '7shifts_punch_report' | 'manual';
  source_period_start: string | null;
  source_period_end: string | null;
  notes: string;
  metadata: Record<string, unknown>;
};

const money = (value: number) => `$${value.toFixed(2)}`;
const numeric = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const centsToDollars = (value: unknown) => Math.round(numeric(value)) / 100;
const cleanDate = (value: unknown) => {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

export function normalizeSevenShiftsWageHistory(
  employee: WageHistoryEmployee,
  wages: SevenShiftsWage[],
  options: {
    detectedAt?: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    earliestEffectiveDate?: string | null;
  } = {},
): WageHistoryRow[] {
  const employeeId = employee.employee_id || (employee.seven_shifts_user_id ? `7S-${employee.seven_shifts_user_id}` : '');
  if (!employeeId) return [];

  const detectedAt = options.detectedAt || new Date().toISOString();
  const earliest = cleanDate(options.earliestEffectiveDate);
  const rows = wages
    .filter(wage => wage.wage_type === 'hourly')
    .map(wage => ({
      raw: wage,
      roleId: wage.role_id == null ? null : String(wage.role_id),
      effectiveDate: cleanDate(wage.effective_date),
      newWage: centsToDollars(wage.wage_cents),
    }))
    .filter(row => row.newWage > 0)
    .filter(row => !earliest || !row.effectiveDate || row.effectiveDate >= earliest)
    .sort((a, b) => [
      a.roleId || '',
      a.effectiveDate || '0000-00-00',
      String(a.newWage).padStart(8, '0'),
    ].join('|').localeCompare([
      b.roleId || '',
      b.effectiveDate || '0000-00-00',
      String(b.newWage).padStart(8, '0'),
    ].join('|')));

  const lastByRole = new Map<string, number>();
  return rows.map(row => {
    const roleKey = row.roleId || '__default__';
    const prior = lastByRole.has(roleKey) ? Number(lastByRole.get(roleKey) || 0) : numeric(employee.wage);
    lastByRole.set(roleKey, row.newWage);
    const note = prior > 0 && Math.abs(prior - row.newWage) > 0.004
      ? `7shifts wage ${row.effectiveDate ? `effective ${row.effectiveDate}` : `detected ${detectedAt.slice(0, 10)}`}: ${money(prior)} → ${money(row.newWage)}`
      : `7shifts wage ${row.effectiveDate ? `effective ${row.effectiveDate}` : `detected ${detectedAt.slice(0, 10)}`}: ${money(row.newWage)}`;

    return {
      employee_id: employeeId,
      seven_shifts_user_id: employee.seven_shifts_user_id ? String(employee.seven_shifts_user_id) : null,
      employee_name: employee.full_name || employeeId,
      location: employee.location || null,
      department: employee.department || null,
      role: employee.role || null,
      role_id: row.roleId || '__default__',
      old_wage: Math.round(prior * 100) / 100,
      new_wage: row.newWage,
      effective_date: row.effectiveDate,
      detected_at: detectedAt,
      source: '7shifts_user_wages',
      source_period_start: cleanDate(options.periodStart),
      source_period_end: cleanDate(options.periodEnd),
      notes: note,
      metadata: { wage: row.raw },
    };
  });
}

export function manualWageHistoryRow(
  employee: WageHistoryEmployee,
  oldWage: number,
  newWage: number,
  detectedAt = new Date().toISOString(),
): WageHistoryRow {
  const employeeId = employee.employee_id || (employee.seven_shifts_user_id ? `7S-${employee.seven_shifts_user_id}` : '');
  return {
    employee_id: employeeId,
    seven_shifts_user_id: employee.seven_shifts_user_id ? String(employee.seven_shifts_user_id) : null,
    employee_name: employee.full_name || employeeId,
    location: employee.location || null,
    department: employee.department || null,
    role: employee.role || null,
    role_id: employee.role_id == null ? '__default__' : String(employee.role_id),
    old_wage: Math.round(numeric(oldWage) * 100) / 100,
    new_wage: Math.round(numeric(newWage) * 100) / 100,
    effective_date: detectedAt.slice(0, 10),
    detected_at: detectedAt,
    source: 'manual',
    source_period_start: null,
    source_period_end: null,
    notes: `Manual wage changed from ${money(numeric(oldWage))} to ${money(numeric(newWage))} on ${detectedAt.slice(0, 10)}`,
    metadata: {},
  };
}

export async function insertWageHistoryRows(supabase: any, rows: WageHistoryRow[]) {
  if (!rows.length) return { inserted: 0, skipped: 0, warning: '' };
  const { error } = await supabase
    .from('employee_wage_history')
    .upsert(rows, { onConflict: 'employee_id,source,effective_date,role_id,new_wage', ignoreDuplicates: false });
  if (!error) return { inserted: rows.length, skipped: 0, warning: '' };
  const missingTable = error.code === '42P01'
    || error.code === 'PGRST205'
    || /employee_wage_history|schema cache|does not exist/i.test(error.message || '');
  if (missingTable) {
    return {
      inserted: 0,
      skipped: rows.length,
      warning: 'employee_wage_history table is not migrated yet; wage changes are still in audit_log.',
    };
  }
  throw error;
}
