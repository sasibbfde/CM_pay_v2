import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { payrollLocationView } from '@/lib/payroll-report';

export const runtime = 'nodejs';
export const maxDuration = 60;

const cyan = 'FF22D3EE';
const dark = 'FF111827';
const green = 'FF10B981';
const gold = 'FFF59E0B';
const purple = 'FFA78BFA';
const lightCyan = 'FFDFFBFF';

function round2(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value: number) {
  return round2(value);
}

function safeName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Sheet';
}

function isManager(row: any) {
  return (row.roles || []).some((role: string) => /manager/i.test(role));
}

function locationBreakdown(row: any) {
  const locations = row.all_locations || row.locations || [];
  if (locations.length <= 1) return '';
  return locations.map((location: string) => {
    const gross = round2(Number(row.location_gross_hours?.[location] || 0));
    const payable = round2(Number(row.location_hours?.[location] || 0));
    return `${location}: actual ${gross}h / payable ${payable}h`;
  }).join(' · ');
}

function labels(row: any) {
  return (row.employee_labels || []).join(', ');
}

function header(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dark } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;
}

function styleManagerRow(excelRow: ExcelJS.Row, row: any) {
  const rowLabels = row.employee_labels || [];
  if (rowLabels.includes('NEW') || rowLabels.includes('MULTI-LOCATION')) {
    excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightCyan } };
  }
  if (rowLabels.includes('OVER 14.2H')) {
    excelRow.getCell(16).font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  if (rowLabels.some((label: string) => /WAGE|MANUAL/i.test(label))) {
    excelRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    excelRow.getCell(5).font = { bold: true, color: { argb: 'FF047857' } };
  }
  if (rowLabels.includes('POSITION CHANGED')) {
    excelRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    excelRow.getCell(4).font = { bold: true, color: { argb: 'FF6D28D9' } };
  }
}

function addManagerSheet(workbook: ExcelJS.Workbook, rows: any[], start: string, end: string) {
  const sheet = workbook.addWorksheet('Manager Hours');
  sheet.mergeCells('A1:Q1');
  sheet.getCell('A1').value = `Manager wages and hours — ${start} to ${end}`;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF111827' } };
  sheet.mergeCells('A2:Q2');
  sheet.getCell('A2').value = 'Source: CM Pay V2 stored payroll rows. Read-only AI Agent export. Sync the exact period first if newer 7shifts data is needed.';
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.addRow([]);

  const head = sheet.addRow([
    '#',
    'Manager',
    'Location(s)',
    'Role(s)',
    'Wage',
    'Cash Wage',
    'Gross Hours',
    'Break Hours',
    'Payable Hours',
    'Cheque Hours',
    'Cash Hours',
    'Cheque Pay',
    'Cash Pay',
    'Holiday Pay',
    'Total Pay',
    'Labels / Status',
    'Location Hour Breakdown',
  ]);
  header(head);

  rows.forEach((row, index) => {
    const excelRow = sheet.addRow([
      index + 1,
      row.employee_name,
      (row.locations || []).join('; '),
      (row.roles || []).join(', '),
      money(row.wage),
      money(row.cash_wage || row.wage),
      round2(row.gross_hours),
      round2(row.break_hours),
      round2(row.payable_hours),
      round2(row.cheque_hours),
      round2(row.cash_hours),
      money(row.cheque_pay),
      money(row.cash_pay),
      money(row.holiday_pay),
      money(row.total_pay),
      [labels(row), row.status, row.wage_change_note, row.detail_change_note].filter(Boolean).join(' · '),
      locationBreakdown(row),
    ]);
    styleManagerRow(excelRow, row);
  });

  const firstDataRow = 5;
  const lastDataRow = rows.length + 4;
  const totalValue = (column: string, value: number) => rows.length ? { formula: `SUM(${column}${firstDataRow}:${column}${lastDataRow})`, result: round2(value) } : 0;
  const totalRow = sheet.addRow([
    '',
    'TOTAL',
    '',
    '',
    '',
    '',
    totalValue('G', rows.reduce((sum, row) => sum + Number(row.gross_hours || 0), 0)),
    totalValue('H', rows.reduce((sum, row) => sum + Number(row.break_hours || 0), 0)),
    totalValue('I', rows.reduce((sum, row) => sum + Number(row.payable_hours || 0), 0)),
    totalValue('J', rows.reduce((sum, row) => sum + Number(row.cheque_hours || 0), 0)),
    totalValue('K', rows.reduce((sum, row) => sum + Number(row.cash_hours || 0), 0)),
    totalValue('L', rows.reduce((sum, row) => sum + Number(row.cheque_pay || 0), 0)),
    totalValue('M', rows.reduce((sum, row) => sum + Number(row.cash_pay || 0), 0)),
    totalValue('N', rows.reduce((sum, row) => sum + Number(row.holiday_pay || 0), 0)),
    totalValue('O', rows.reduce((sum, row) => sum + Number(row.total_pay || 0), 0)),
    '',
    '',
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

  sheet.columns = [7, 30, 34, 22, 12, 12, 13, 13, 14, 14, 12, 14, 14, 14, 14, 42, 80].map(width => ({ width }));
  sheet.views = [{ state: 'frozen', ySplit: 4, xSplit: 2 }];
  sheet.autoFilter = { from: 'A4', to: 'Q4' };
  [5, 6, 12, 13, 14, 15].forEach(column => { sheet.getColumn(column).numFmt = '$#,##0.00'; });
  [7, 8, 9, 10, 11].forEach(column => { sheet.getColumn(column).numFmt = '0.00'; });
}

function addByLocationSheet(workbook: ExcelJS.Workbook, rows: any[]) {
  const sheet = workbook.addWorksheet('By Location');
  const head = sheet.addRow(['Location', 'Managers', 'Gross Hours', 'Payable Hours', 'Cheque Hours', 'Cash Hours', 'Cheque Pay', 'Cash Pay', 'Holiday Pay', 'Total Pay']);
  header(head);

  const byLocation = new Map<string, any>();
  for (const row of rows) {
    for (const location of row.locations || []) {
      const local = payrollLocationView(row, location);
      const item = byLocation.get(location) || {
        location,
        managers: new Set<string>(),
        gross: 0,
        payable: 0,
        cheque: 0,
        cash: 0,
        chequePay: 0,
        cashPay: 0,
        holidayPay: 0,
        totalPay: 0,
      };
      item.managers.add(row.employee_id || row.employee_name);
      item.gross += Number(local.gross_hours || 0);
      item.payable += Number(local.payable_hours || 0);
      item.cheque += Number(local.cheque_hours || 0);
      item.cash += Number(local.cash_hours || 0);
      item.chequePay += Number(local.cheque_pay || 0);
      item.cashPay += Number(local.cash_pay || 0);
      item.holidayPay += Number(local.holiday_pay || 0);
      item.totalPay += Number(local.total_pay || 0);
      byLocation.set(location, item);
    }
  }

  [...byLocation.values()]
    .sort((a, b) => b.totalPay - a.totalPay)
    .forEach(row => {
      sheet.addRow([
        row.location,
        row.managers.size,
        round2(row.gross),
        round2(row.payable),
        round2(row.cheque),
        round2(row.cash),
        money(row.chequePay),
        money(row.cashPay),
        money(row.holidayPay),
        money(row.totalPay),
      ]);
    });
  sheet.columns = [30, 12, 14, 14, 14, 12, 14, 14, 14, 14].map(width => ({ width }));
  [3, 4, 5, 6].forEach(column => { sheet.getColumn(column).numFmt = '0.00'; });
  [7, 8, 9, 10].forEach(column => { sheet.getColumn(column).numFmt = '$#,##0.00'; });
}

function addLegendSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.addWorksheet('Legend');
  sheet.columns = [{ width: 28 }, { width: 80 }];
  const head = sheet.addRow(['Label', 'Meaning']);
  header(head);
  [
    ['NEW', 'Employee is inside the first payroll-period window.'],
    ['MULTI-LOCATION', 'Employee worked more than one location. Hours remain split by worked location.'],
    ['7SHIFTS WAGE ↑ / MANUAL WAGE', 'Wage changed during the selected period; source is shown in labels/notes.'],
    ['POSITION CHANGED', 'Role/location details changed during the selected period.'],
    ['OVER 14.2H', 'A daily punch total exceeded the payroll review threshold.'],
  ].forEach(row => sheet.addRow(row));
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const type = params.get('type') || 'manager-hours';
    const start = params.get('start') || '';
    const end = params.get('end') || '';
    if (type !== 'manager-hours') return NextResponse.json({ ok: false, error: 'Unsupported export type.' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ ok: false, error: 'Valid start and end dates are required.' }, { status: 400 });
    }

    const report = await getPayrollReport(start, end);
    const rows = report.rows
      .filter(isManager)
      .sort((a, b) => String(a.locations?.[0] || '').localeCompare(String(b.locations?.[0] || '')) || String(a.employee_name).localeCompare(String(b.employee_name)));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CM Pay V2 AI Payroll Agent';
    workbook.created = new Date();
    workbook.modified = new Date();

    addManagerSheet(workbook, rows, start, end);
    addByLocationSheet(workbook, rows);
    addLegendSheet(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Manager_Hours_Wages_${start}_${end}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Manager export failed.' }, { status: 500 });
  }
}
