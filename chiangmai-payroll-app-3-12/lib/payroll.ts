import { Employee, EmployeeRule, PayrollRow, Punch } from './types';
import { resolveCashWage } from './cash-rates';

const PAYROLL_TIME_ZONE = 'America/Toronto';
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function getPayrollDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PAYROLL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getPunchHours(p: Punch) {
  const given = Number(p.hours || 0);
  if (given > 0) return given;
  const start = new Date(p.clocked_in).getTime();
  const end = new Date(p.clocked_out).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round((end - start) / 3_600_000);
}

export function getPeriodDateRange(year: number, month: number, period: string) {
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (period === '1-15') return { start: dateString(year, month, 1), end: dateString(year, month, 15) };
  if (period === '16-end') return { start: dateString(year, month, 16), end: dateString(year, month, endDay) };
  return { start: dateString(year, month, 1), end: dateString(year, month, endDay) };
}

export function filterPunches(punches: Punch[], year: number, month: number, period: string) {
  const { start, end } = getPeriodDateRange(year, month, period);
  return filterPunchesByDateRange(punches, start, end);
}

export function filterPunchesByDateRange(punches: Punch[], start: string, end: string) {
  return punches.filter(p => {
    const date = getPayrollDate(p.clocked_in);
    return Boolean(date && date >= start && date <= end);
  });
}

export function applyEmployeeWages(punches: Punch[], employees: Employee[]) {
  const byId = new Map<string, Employee>();
  const byName = new Map<string, Employee>();
  for (const employee of employees) {
    if (employee.employee_id) byId.set(employee.employee_id, employee);
    if (employee.seven_shifts_user_id) {
      byId.set(employee.seven_shifts_user_id, employee);
      byId.set(`7S-${employee.seven_shifts_user_id}`, employee);
    }
    byName.set(norm(employee.full_name), employee);
  }
  return punches.map(punch => {
    const employee = (punch.employee_id && byId.get(punch.employee_id)) || byName.get(norm(punch.employee_name));
    if (!employee) return punch;
    return {
      ...punch,
      wage: Number(employee.wage || 0),
      cash_wage: resolveCashWage({
        name: punch.employee_name || employee.full_name,
        location: punch.location || employee.location,
        cash_wage: punch.cash_wage || employee.cash_wage,
      }),
    };
  });
}

function ruleApplies(rule: EmployeeRule, date: string) {
  return rule.active !== false
    && (!rule.effective_from || date >= rule.effective_from)
    && (!rule.effective_to || date <= rule.effective_to);
}

function addPay(
  punch: Punch,
  payrollHours: number,
  cashHours: number,
  totals: { payrollHours: number; cashHours: number; payrollAmount: number; cashAmount: number },
) {
  const wage = Number(punch.wage || 0);
  const cashWage = Number(punch.cash_wage || 0) || wage;
  totals.payrollHours += payrollHours;
  totals.cashHours += cashHours;
  totals.payrollAmount += payrollHours * wage;
  totals.cashAmount += cashHours * cashWage;
}

export function calculatePayroll(punches: Punch[], rules: EmployeeRule[]): PayrollRow[] {
  const grouped = new Map<string, Punch[]>();
  for (const punch of punches) {
    const key = punch.employee_id ? `id:${punch.employee_id}` : `name:${norm(punch.employee_name || 'Unknown')}`;
    grouped.set(key, [...(grouped.get(key) || []), punch]);
  }

  const activeRules = rules.filter(rule => rule.active !== false);
  const rulesById = new Map<string, EmployeeRule[]>();
  const rulesByName = new Map<string, EmployeeRule[]>();
  activeRules.forEach(rule => {
    if (rule.employee_id) rulesById.set(rule.employee_id, [...(rulesById.get(rule.employee_id) || []), rule]);
    const name = norm(rule.employee_name);
    rulesByName.set(name, [...(rulesByName.get(name) || []), rule]);
  });

  const rows: PayrollRow[] = [];
  for (const items of grouped.values()) {
    items.sort((a, b) => a.clocked_in.localeCompare(b.clocked_in));
    const first = items[0];
    const candidates = [
      ...(first.employee_id ? rulesById.get(first.employee_id) || [] : []),
      ...(rulesByName.get(norm(first.employee_name)) || []),
    ].filter((rule, index, all) => all.indexOf(rule) === index)
      .sort((a, b) => (b.effective_from || '').localeCompare(a.effective_from || ''));

    const partitions = new Map<EmployeeRule | undefined, Punch[]>();
    for (const punch of items) {
      const date = getPayrollDate(punch.clocked_in);
      const rule = candidates.find(candidate => ruleApplies(candidate, date));
      partitions.set(rule, [...(partitions.get(rule) || []), punch]);
    }

    const totals = { payrollHours: 0, cashHours: 0, payrollAmount: 0, cashAmount: 0 };
    const ruleNames = new Set<string>();
    const notes = new Set<string>();
    let payrollLocation = first.location;

    for (const [rule, segment] of partitions) {
      const type = rule?.rule_type || 'STANDARD';
      ruleNames.add(type);
      if (rule?.notes) notes.add(rule.notes);
      const cap = Number(rule?.rule_value || 0);
      let remaining = cap;

      if (type === 'SALARY_FIXED') {
        totals.payrollHours += segment.reduce((sum, punch) => sum + getPunchHours(punch), 0);
        totals.payrollAmount += cap;
        continue;
      }

      if (type === 'PAY_UNDER_OTHER_LOCATION') {
        payrollLocation = rule?.payroll_location || payrollLocation;
      }

      const capLocations = new Set((rule?.combined_locations || '').split(',').map(norm).filter(Boolean));
      for (const punch of segment) {
        const hours = getPunchHours(punch);
        if (type === 'HOLD_PAYROLL') continue;
        if (type === 'CASH_ONLY') {
          addPay(punch, 0, hours, totals);
        } else if (type === 'PARTIAL_CASH') {
          if (capLocations.has(norm(punch.location))) addPay(punch, 0, hours, totals);
          else addPay(punch, hours, 0, totals);
        } else if (type === 'PAYROLL_HOURS_CAP') {
          const payrollHours = Math.min(hours, Math.max(remaining, 0));
          addPay(punch, payrollHours, hours - payrollHours, totals);
          remaining -= payrollHours;
        } else if (type === 'COMBINED_LOCATION_CAP' && (capLocations.size === 0 || capLocations.has(norm(punch.location)))) {
          const payrollHours = Math.min(hours, Math.max(remaining, 0));
          addPay(punch, payrollHours, hours - payrollHours, totals);
          remaining -= payrollHours;
        } else {
          addPay(punch, hours, 0, totals);
        }
      }
    }

    const actual = round(items.reduce((sum, punch) => sum + getPunchHours(punch), 0));
    const weightedWage = actual > 0
      ? items.reduce((sum, punch) => sum + getPunchHours(punch) * Number(punch.wage || 0), 0) / actual
      : Number(first.wage || 0);

    rows.push({
      employee_id: first.employee_id,
      employee_name: first.employee_name,
      location: payrollLocation,
      department: first.department,
      role: first.role,
      actual_hours: actual,
      payroll_hours: round(totals.payrollHours),
      cash_hours: round(totals.cashHours),
      wage: round(weightedWage),
      payroll_amount: round(totals.payrollAmount),
      cash_amount: round(totals.cashAmount),
      rule_applied: [...ruleNames].join(' + '),
      notes: [...notes].join(' | '),
    });
  }

  return rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

export function summarizeDailyLabour(punches: Punch[]) {
  const grouped = new Map<string, { date:string; location:string; hours:number; cost:number; employees:Set<string> }>();
  for (const punch of punches) {
    if (!punch.clocked_out) continue;
    const date = getPayrollDate(punch.clocked_in);
    if (!date) continue;
    const location = punch.location || 'Unknown';
    const key = `${date}\u0000${location}`;
    const row = grouped.get(key) || { date, location, hours:0, cost:0, employees:new Set<string>() };
    const hours = getPunchHours(punch);
    row.hours += hours;
    row.cost += hours * Number(punch.wage || 0);
    row.employees.add(punch.employee_id || punch.employee_name);
    grouped.set(key, row);
  }
  return [...grouped.values()].map(row => ({
    date:row.date,
    location:row.location,
    hours:round(row.hours),
    cost:round(row.cost),
    employees:row.employees.size,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location));
}

export type LabourGroup = 'Back of House' | 'Front of House' | 'Managers' | 'Other';

export function getLabourGroup(department?: string, role?: string): LabourGroup {
  const dept = norm(department || '');
  const job = norm(role || '');
  if (dept.includes('manager') || dept.includes('management') || job.includes('manager')) return 'Managers';
  if (dept.includes('front of house') || dept === 'foh') return 'Front of House';
  if (dept.includes('back of house') || dept === 'boh') return 'Back of House';
  return 'Other';
}

export function summarizeLabourGroups(punches: Punch[]) {
  const grouped = new Map<string, { group:LabourGroup; location:string; hours:number; cost:number; employees:Set<string> }>();
  for (const punch of punches) {
    if (!punch.clocked_out) continue;
    const group = getLabourGroup(punch.department, punch.role);
    const location = punch.location || 'Unknown';
    const key = `${location}\u0000${group}`;
    const row = grouped.get(key) || { group, location, hours:0, cost:0, employees:new Set<string>() };
    const hours = getPunchHours(punch);
    row.hours += hours;
    row.cost += hours * Number(punch.wage || 0);
    row.employees.add(punch.employee_id || punch.employee_name);
    grouped.set(key, row);
  }
  return [...grouped.values()].map(row => ({
    group:row.group,
    location:row.location,
    hours:round(row.hours),
    cost:round(row.cost),
    employees:row.employees.size,
  })).sort((a,b)=>a.location.localeCompare(b.location)||a.group.localeCompare(b.group));
}

export function summarizeDailyLabourGroups(punches: Punch[]) {
  const grouped = new Map<string, { date:string; group:LabourGroup; location:string; hours:number; cost:number; employees:Set<string> }>();
  for (const punch of punches) {
    if (!punch.clocked_out) continue;
    const date = getPayrollDate(punch.clocked_in); if (!date) continue;
    const group = getLabourGroup(punch.department, punch.role);
    const location = punch.location || 'Unknown';
    const key = `${date}\u0000${location}\u0000${group}`;
    const row = grouped.get(key) || { date, group, location, hours:0, cost:0, employees:new Set<string>() };
    const hours = getPunchHours(punch); row.hours += hours; row.cost += hours * Number(punch.wage || 0); row.employees.add(punch.employee_id || punch.employee_name); grouped.set(key,row);
  }
  return [...grouped.values()].map(row=>({date:row.date,group:row.group,location:row.location,hours:round(row.hours),cost:round(row.cost),employees:row.employees.size})).sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location)||a.group.localeCompare(b.group));
}

export function summarizeEmployeeLabourByLocation(punches: Punch[]) {
  const grouped = new Map<string, { employee_id?:string; employee_name:string; location:string; department?:string; role?:string; actual_hours:number; payroll_hours:number; wage_cost:number; employees:Set<string> }>();
  for (const punch of punches) {
    if (!punch.clocked_out) continue;
    const location = punch.location || 'Unknown';
    const employeeKey = punch.employee_id || norm(punch.employee_name || 'Unknown');
    const key = `${employeeKey}\u0000${location}`;
    const row = grouped.get(key) || { employee_id:punch.employee_id, employee_name:punch.employee_name, location, department:punch.department, role:punch.role, actual_hours:0, payroll_hours:0, wage_cost:0, employees:new Set<string>() };
    const payrollHours = getPunchHours(punch);
    const grossHours = Number(punch.gross_hours || 0) || payrollHours;
    row.actual_hours += grossHours;
    row.payroll_hours += payrollHours;
    row.wage_cost += payrollHours * Number(punch.wage || 0);
    row.employees.add(employeeKey);
    grouped.set(key, row);
  }
  return [...grouped.values()].map(({employees:_, ...row}) => ({
    ...row,
    actual_hours:round(row.actual_hours),
    payroll_hours:round(row.payroll_hours),
    payroll_amount:round(row.wage_cost),
    cash_hours:0,
    cash_amount:0,
    wage:row.payroll_hours ? round(row.wage_cost / row.payroll_hours) : 0,
    rule_applied:'ACTUAL LOCATION',
  })).sort((a,b)=>a.location.localeCompare(b.location)||a.employee_name.localeCompare(b.employee_name));
}

export function summarize(rows: PayrollRow[]) {
  return {
    employees: rows.length,
    totalHours: round(rows.reduce((sum, row) => sum + row.actual_hours, 0)),
    payrollHours: round(rows.reduce((sum, row) => sum + row.payroll_hours, 0)),
    cashHours: round(rows.reduce((sum, row) => sum + row.cash_hours, 0)),
    payrollAmount: round(rows.reduce((sum, row) => sum + row.payroll_amount, 0)),
    cashAmount: round(rows.reduce((sum, row) => sum + row.cash_amount, 0)),
    exceptions: rows.filter(row => row.rule_applied !== 'STANDARD').length,
  };
}
