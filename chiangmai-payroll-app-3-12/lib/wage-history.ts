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

export type PayrollReportWageEntry = {
  employee_id?: string | null;
  seven_shifts_user_id?: string | null;
  employee_name: string;
  location?: string | null;
  department?: string | null;
  role?: string | null;
  wage: number;
  observed_date: string;
  period_start: string;
  period_end: string;
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

export function normalizePayrollReportWageHistory(
  entries: PayrollReportWageEntry[],
  detectedAt = new Date().toISOString(),
  previousWageByEmployee: Record<string, number> = {},
): WageHistoryRow[] {
  const dateWageGroups = new Map<string, PayrollReportWageEntry[]>();
  for (const entry of entries) {
    if (!entry.employee_id || !entry.employee_name || Number(entry.wage || 0) <= 0 || !cleanDate(entry.observed_date)) continue;
    const wage = Math.round(Number(entry.wage || 0) * 100) / 100;
    const key = `${entry.employee_id}|${cleanDate(entry.observed_date)}|${wage.toFixed(2)}`;
    dateWageGroups.set(key, [...(dateWageGroups.get(key) || []), entry]);
  }

  const dailyEntries = new Map<string, PayrollReportWageEntry>();
  for (const group of dateWageGroups.values()) {
    const entry = group[0];
    const wage = Math.round(Number(entry.wage || 0) * 100) / 100;
    const key = `${entry.employee_id}|${cleanDate(entry.observed_date)}`;
    const existing = dailyEntries.get(key);
    if (!existing) {
      dailyEntries.set(key, { ...entry, wage });
      continue;
    }
    const existingCount = dateWageGroups.get(`${existing.employee_id}|${cleanDate(existing.observed_date)}|${Number(existing.wage || 0).toFixed(2)}`)?.length || 0;
    const candidateCount = group.length;
    const existingWage = Number(existing.wage || 0);
    // If one wage appears more often on the same employee/day, use it as the
    // day-level salary observation. On ties, keep the higher observed rate so
    // raises are not hidden by one lower-rate shift on the same day.
    if (candidateCount > existingCount || (candidateCount === existingCount && wage > existingWage)) {
      dailyEntries.set(key, { ...entry, wage });
    }
  }

  const sorted = [...dailyEntries.values()]
    .sort((a, b) => [
      a.employee_id || '',
      a.observed_date,
      a.period_start,
      a.location || '',
      a.role || '',
    ].join('|').localeCompare([
      b.employee_id || '',
      b.observed_date,
      b.period_start,
      b.location || '',
      b.role || '',
    ].join('|')));

  const lastByEmployee = new Map<string, number>();
  for (const [employeeId, wage] of Object.entries(previousWageByEmployee || {})) {
    const parsed = Math.round(Number(wage || 0) * 100) / 100;
    if (parsed > 0) lastByEmployee.set(employeeId, parsed);
  }
  const rows: WageHistoryRow[] = [];
  for (const entry of sorted) {
    const wage = Math.round(Number(entry.wage || 0) * 100) / 100;
    const key = String(entry.employee_id);
    const previous = lastByEmployee.get(key) || 0;
    if (previous > 0 && Math.abs(previous - wage) < 0.005) continue;
    lastByEmployee.set(key, wage);

    const effectiveDate = cleanDate(entry.observed_date);
    rows.push({
      employee_id: String(entry.employee_id),
      seven_shifts_user_id: entry.seven_shifts_user_id ? String(entry.seven_shifts_user_id) : null,
      employee_name: entry.employee_name,
      location: entry.location || null,
      department: entry.department || null,
      role: entry.role || null,
      role_id: '__employee_wage_evolution__',
      old_wage: previous,
      new_wage: wage,
      effective_date: effectiveDate,
      detected_at: detectedAt,
      source: '7shifts_punch_report',
      source_period_start: cleanDate(entry.period_start),
      source_period_end: cleanDate(entry.period_end),
      notes: previous > 0
        ? `Employee wage evolution from payroll reports: ${money(previous)} → ${money(wage)} on ${effectiveDate}`
        : `Employee wage baseline from payroll reports: ${money(wage)} first observed on ${effectiveDate}`,
      metadata: {
        history_type: 'employee_wage_evolution',
        location: entry.location || null,
        role: entry.role || null,
      },
    });
  }
  return rows;
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
