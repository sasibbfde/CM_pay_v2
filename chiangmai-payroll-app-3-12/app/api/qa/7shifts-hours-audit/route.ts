import { NextRequest, NextResponse } from 'next/server';
import { fetchHoursAndWages } from '@/lib/7shifts';
import { flattenHoursAndWagesReport } from '@/lib/hours-wages';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { payrollLocationView, type PayrollReportRow } from '@/lib/payroll-report';

export const maxDuration = 120;
const AUDIT_VERSION = '2026-07-27-shift-lines-only-v2';

const LOCATION_IDS: Record<string, string> = {
  'Chiang Mai Junction': '461096',
  'Chiang Mai Parklawn': '465654',
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const keyName = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function locationList(value: string | null) {
  if (!value) return Object.keys(LOCATION_IDS);
  return value.split(',')
    .map(item => item.trim())
    .filter(item => LOCATION_IDS[item]);
}

function emptyTotals() {
  return { employees: 0, gross_hours: 0, break_hours: 0, payable_hours: 0 };
}

function addTotals(target: ReturnType<typeof emptyTotals>, gross: number, breakHours: number, payable: number) {
  target.employees += 1;
  target.gross_hours = round2(target.gross_hours + gross);
  target.break_hours = round2(target.break_hours + breakHours);
  target.payable_hours = round2(target.payable_hours + payable);
}

function aggregateText(value?: string) {
  return /(total|subtotal|summary|break|no shifts|unpaid|paid break)/i.test(value || '');
}

function isCountableShiftEntry(entry: any) {
  const name = entry.employee_name || '';
  if (!name || /^7shifts user unknown/i.test(name)) return false;
  if (aggregateText(entry.employee_name) || aggregateText(entry.role) || aggregateText(entry.shift_details)) return false;
  return Boolean(entry.punch_id || entry.clocked_in || entry.clocked_out || entry.shift_details);
}

function summarizeSevenShifts(report: any, start: string, end: string) {
  const byEmployee = new Map<string, any>();
  let raw_entries = 0;
  let counted_entries = 0;
  let ignored_entries = 0;
  for (const entry of flattenHoursAndWagesReport(report)) {
    raw_entries += 1;
    if (!isCountableShiftEntry(entry)) {
      ignored_entries += 1;
      continue;
    }
    const workDate = entry.date || (entry.clocked_in ? String(entry.clocked_in).slice(0, 10) : '');
    if (!workDate || workDate < start || workDate > end) {
      ignored_entries += 1;
      continue;
    }
    const name = entry.employee_name || `7shifts user ${entry.user_id || 'unknown'}`;
    const key = keyName(name) || name;
    const gross = Number(entry.gross_hours ?? entry.regular_hours ?? 0);
    const payable = Number(entry.regular_hours ?? gross);
    const breakHours = Number.isFinite(Number(entry.break_minutes))
      ? Number(entry.break_minutes) / 60
      : Math.max(0, gross - payable);
    const row = byEmployee.get(key) || { employee_name: name, gross_hours: 0, break_hours: 0, payable_hours: 0, shifts: 0 };
    row.gross_hours = round2(row.gross_hours + gross);
    row.break_hours = round2(row.break_hours + breakHours);
    row.payable_hours = round2(row.payable_hours + payable);
    row.shifts += 1;
    byEmployee.set(key, row);
    counted_entries += 1;
  }
  const totals = emptyTotals();
  for (const row of byEmployee.values()) addTotals(totals, row.gross_hours, row.break_hours, row.payable_hours);
  return {
    totals,
    diagnostics: { raw_entries, counted_entries, ignored_entries },
    employees: [...byEmployee.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
  };
}

function summarizeApp(rows: PayrollReportRow[], location: string) {
  const employees = rows
    .filter(row => row.locations.includes(location))
    .map(row => {
      const local = payrollLocationView(row, location);
      return {
        employee_name: row.employee_name,
        gross_hours: local.gross_hours,
        break_hours: local.break_hours,
        payable_hours: local.payable_hours,
        cheque_hours: local.cheque_hours,
        cash_hours: local.cash_hours,
      };
    });
  const totals = emptyTotals();
  for (const row of employees) addTotals(totals, row.gross_hours, row.break_hours, row.payable_hours);
  return { totals, employees };
}

function diffTotals(app: ReturnType<typeof emptyTotals>, seven: ReturnType<typeof emptyTotals>) {
  return {
    employees: app.employees - seven.employees,
    gross_hours: round2(app.gross_hours - seven.gross_hours),
    break_hours: round2(app.break_hours - seven.break_hours),
    payable_hours: round2(app.payable_hours - seven.payable_hours),
  };
}

function employeeDifferences(appEmployees: any[], sevenEmployees: any[]) {
  const appMap = new Map(appEmployees.map(row => [keyName(row.employee_name), row]));
  const sevenMap = new Map(sevenEmployees.map(row => [keyName(row.employee_name), row]));
  const keys = new Set([...appMap.keys(), ...sevenMap.keys()]);
  return [...keys].map(key => {
    const app = appMap.get(key);
    const seven = sevenMap.get(key);
    return {
      employee_name: app?.employee_name || seven?.employee_name || key,
      app_payable_hours: round2(Number(app?.payable_hours || 0)),
      seven_shifts_payable_hours: round2(Number(seven?.payable_hours || 0)),
      payable_diff: round2(Number(app?.payable_hours || 0) - Number(seven?.payable_hours || 0)),
      app_gross_hours: round2(Number(app?.gross_hours || 0)),
      seven_shifts_gross_hours: round2(Number(seven?.gross_hours || 0)),
      gross_diff: round2(Number(app?.gross_hours || 0) - Number(seven?.gross_hours || 0)),
    };
  })
    .filter(row => Math.abs(row.payable_diff) >= 0.01 || Math.abs(row.gross_diff) >= 0.01)
    .sort((a, b) => Math.abs(b.payable_diff) - Math.abs(a.payable_diff));
}

export async function GET(request: NextRequest) {
  const start = request.nextUrl.searchParams.get('start');
  const end = request.nextUrl.searchParams.get('end');
  if (!validDate(start) || !validDate(end) || start! > end!) {
    return NextResponse.json({ error: 'Valid start and end dates are required' }, { status: 400 });
  }

  const locations = locationList(request.nextUrl.searchParams.get('locations'));
  if (!locations.length) return NextResponse.json({ error: 'No supported locations requested' }, { status: 400 });

  try {
    const appReport = await getPayrollReport(start!, end!);
    const audits = await Promise.all(locations.map(async location => {
      const seven = summarizeSevenShifts(await fetchHoursAndWages(start!, end!, LOCATION_IDS[location]), start!, end!);
      const app = summarizeApp(appReport.rows, location);
      return {
        location,
        seven_shifts_location_id: LOCATION_IDS[location],
        app: app.totals,
        seven_shifts_report: seven.totals,
        seven_shifts_diagnostics: seven.diagnostics,
        difference_app_minus_7shifts: diffTotals(app.totals, seven.totals),
        employee_differences: employeeDifferences(app.employees, seven.employees),
      };
    }));

    return NextResponse.json({
      ok: true,
      audit_version: AUDIT_VERSION,
      source: {
        app: 'CM Pay /api/payroll-report (stored payroll rows)',
        seven_shifts: '7shifts Reports API /reports/hours_and_wages',
      },
      start,
      end,
      locations: audits,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Audit failed' }, { status: 500 });
  }
}
