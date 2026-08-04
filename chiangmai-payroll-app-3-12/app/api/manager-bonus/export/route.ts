import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getManagerBonusRows } from '@/lib/manager-bonus-data';
import {
  DEFAULT_MANAGER_BONUS_POOL,
  MANAGER_BONUS_RUBRICS,
  managerBonusTrack,
  rubricForManager,
} from '@/lib/manager-bonus';

const BRAND = {
  purple:'FF4A1B3C',
  deep:'FF33132A',
  gold:'FFEDDDB0',
  cream:'FFF6F1E9',
  input:'FFFFFDE7',
  teal:'FF14857E',
  white:'FFFFFFFF',
  black:'FF000000',
};

const LOCATION_COLORS: Record<string, string> = {
  'Chiang Mai Liberty Village':'FFE8F7EF',
  'Chiang Mai York Mills':'FFEAF3FF',
  'Chiang Mai Mississauga':'FFFFF1E6',
  'Chiang Mai Parklawn':'FFF3ECFF',
  'Chiang Mai Junction':'FFFFF8D7',
  'Chiang Mai Danforth':'FFEFF7F8',
  'Imm Thai Kitchen':'FFFFEBEF',
  Unknown:'FFF1F5F9',
  Unassigned:'FFF1F5F9',
};

const TEMPLATE_LOCATIONS = ['Liberty','York Mills','Mississauga','Parklawn','Junction','Danforth','Imm Thai Kitchen','Unassigned / Other'];

type ManagerRow = any;

function styleHeader(row: ExcelJS.Row, color = BRAND.deep) {
  row.font = { bold:true, color:{ argb:BRAND.white } };
  row.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:color } };
  row.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
}

function styleTitle(sheet: ExcelJS.Worksheet, range: string, title: string) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0]);
  cell.value = title;
  cell.font = { bold:true, size:18, color:{ argb:BRAND.white } };
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.purple } };
  cell.alignment = { vertical:'middle' };
}

function styleInput(cell: ExcelJS.Cell) {
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.input } };
  cell.font = { color:{ argb:'FF0000FF' } };
}

function setCurrency(cell: ExcelJS.Cell) {
  cell.numFmt = '"$"#,##0.00';
}

function setHours(cell: ExcelJS.Cell) {
  cell.numFmt = '#,##0.00';
}

function setPercent(cell: ExcelJS.Cell) {
  cell.numFmt = '0.0%';
}

function shortLocation(location: string) {
  const value = location || 'Unassigned';
  return value
    .replace(/^Chiang Mai\s+/i, '')
    .replace(/Liberty Village/i, 'Liberty')
    .replace(/Imm Thai Kitchen/i, 'Imm Thai Kitchen')
    .trim() || 'Unassigned';
}

function locationFill(location: string) {
  return LOCATION_COLORS[location] || LOCATION_COLORS[shortLocation(location)] || LOCATION_COLORS.Unknown;
}

function sheetSafeName(name: string, fallback = 'Manager') {
  const cleaned = (name || fallback).replace(/[\\/*?:[\]]/g, '').trim() || fallback;
  return cleaned.slice(0, 31);
}

function uniqueSheetName(workbook: ExcelJS.Workbook, name: string) {
  const base = sheetSafeName(name);
  let next = base;
  let index = 2;
  while (workbook.getWorksheet(next)) {
    const suffix = ` ${index++}`;
    next = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  return next;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month:'short', year:'numeric' });
}

function parseMonthFromStart(start: string) {
  return start.slice(0, 7);
}

function periodLabel(start: string, end: string) {
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  if (startDay === 1 && endDay === 15) return '1–15';
  if (startDay === 16) return '16–End';
  return 'Full month';
}

function monthRange(month: string) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(year, number, 0).getDate();
  return { start:`${month}-01`, end:`${month}-${String(last).padStart(2, '0')}` };
}

function totals(rows: ManagerRow[]) {
  return rows.reduce((sum, row) => ({
    managers:sum.managers + 1,
    hours:sum.hours + Number(row.worked_hours || 0),
    original:sum.original + Number(row.original_bonus || 0),
    extra:sum.extra + Number(row.earnedExtraBonus || 0),
    final:sum.final + Number(row.finalBonus || 0),
    points:sum.points + Number(row.totalPoints || 0),
    max:sum.max + Number(row.max_points || 0),
  }), { managers:0, hours:0, original:0, extra:0, final:0, points:0, max:0 });
}

function status(row: ManagerRow) {
  const ratings = Array.isArray(row.rubric_ratings) ? row.rubric_ratings : [];
  if (!Number(row.original_bonus || 0)) return 'Not started';
  return ratings.filter((value: unknown) => value !== null && value !== undefined && value !== '').length === 10 ? 'Done' : 'In progress';
}

function addSettings(workbook: ExcelJS.Workbook, selectedMonth: string, locationFilter: string, months: string[]) {
  const sheet = workbook.addWorksheet('Settings');
  sheet.columns = [{ width:38 }, { width:24 }, { width:80 }, { width:18 }, { width:24 }, { width:18 }];
  styleTitle(sheet, 'A1:F1', 'Manager Bonus Plan — Settings');
  sheet.addRow([]);
  sheet.addRow(['Program Default Bonus Pool %', DEFAULT_MANAGER_BONUS_POOL, 'Applies to every manager unless the manager row has a custom %.', '', '', '']);
  sheet.addRow(['Current Period (month being scored)', selectedMonth, 'This workbook was exported for this month.', '', '', '']);
  sheet.addRow(['Location Filter', locationFilter || 'All locations', 'The report only includes this location if a location was selected.', '', '', '']);
  styleInput(sheet.getCell('B3')); styleInput(sheet.getCell('B4')); styleInput(sheet.getCell('B5'));
  sheet.addRow([]);
  styleHeader(sheet.addRow(['Rating', 'Meaning', 'Bonus Rule']));
  [[0,'No mark / does not meet standard','No points earned for that area'],[1,'Very poor','Low points'],[2,'Needs improvement','Below standard'],[3,'Meets minimum standard','Acceptable'],[4,'Good','Strong'],[5,'Top performance','Full points for that area']]
    .forEach(row => sheet.addRow(row));
  sheet.addRow([]);
  sheet.addRow(['Locations', '', '', 'Roles']);
  TEMPLATE_LOCATIONS.filter(item => item !== 'Unassigned / Other').forEach((loc, index) => {
    sheet.addRow([loc, '', '', index === 0 ? 'Front' : index === 1 ? 'Kitchen' : '']);
  });
  sheet.addRow([]);
  sheet.addRow(['Front of House — Evaluation Categories']);
  styleHeader(sheet.addRow(['Category', 'What to review']));
  MANAGER_BONUS_RUBRICS.Front.forEach(item => sheet.addRow([item.label, item.description]));
  sheet.addRow([]);
  sheet.addRow(['Kitchen — Evaluation Categories']);
  styleHeader(sheet.addRow(['Category', 'What to review']));
  MANAGER_BONUS_RUBRICS.Kitchen.forEach(item => sheet.addRow([item.label, item.description]));
  sheet.addRow([]);
  sheet.addRow(['Plan Months — the months included in this export']);
  styleHeader(sheet.addRow(['Month', 'Order']));
  months.forEach((month, index) => sheet.addRow([month, index + 1]));
  sheet.views = [{ state:'frozen', ySplit:1 }];
}

function addAllManagers(workbook: ExcelJS.Workbook, rows: ManagerRow[]) {
  const sheet = workbook.addWorksheet('All Managers');
  sheet.columns = [
    { width:30 }, { width:24 }, { width:18 }, { width:14 }, { width:16 }, { width:13 },
    { width:12 }, { width:12 }, { width:12 }, { width:15 }, { width:15 }, { width:15 }, { width:16 },
  ];
  styleTitle(sheet, 'A1:M1', 'All Managers — Current Period');
  sheet.addRow([]);
  styleHeader(sheet.addRow(['Name','Location','Role','Worked Hours','Original Bonus','Pool % Used','Total Points','Max Points','Score %','Max Extra','Earned Extra','Final Bonus','Status']));
  rows.forEach(row => {
    const excelRow = sheet.addRow([
      row.employee_name,
      row.location,
      row.role || row.department || 'Manager',
      Number(row.worked_hours || 0),
      Number(row.original_bonus || 0),
      Number(row.bonus_pool || DEFAULT_MANAGER_BONUS_POOL) / 100,
      Number(row.totalPoints || 0),
      Number(row.max_points || 50),
      Number(row.scorePercent || 0),
      Number(row.maxExtraBonus || 0),
      Number(row.earnedExtraBonus || 0),
      Number(row.finalBonus || 0),
      status(row),
    ]);
    excelRow.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:locationFill(row.location) } };
      cell.border = { bottom:{ style:'thin', color:{ argb:'FFE5E7EB' } } };
    });
  });
  const total = totals(rows);
  const totalRow = sheet.addRow(['Totals','','',total.hours,total.original,'',total.points,total.max,total.max ? total.points / total.max : 0,total.original * DEFAULT_MANAGER_BONUS_POOL / 100,total.extra,total.final,'']);
  totalRow.font = { bold:true };
  totalRow.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.gold } };
  [4].forEach(col => setHours(sheet.getCell(totalRow.number, col)));
  [5,10,11,12].forEach(col => setCurrency(sheet.getCell(totalRow.number, col)));
  [6,9].forEach(col => setPercent(sheet.getCell(totalRow.number, col)));

  sheet.addRow([]);
  sheet.addRow(['Location Subtotals']);
  styleHeader(sheet.addRow(['Location', 'Worked Hours', 'Original Bonus', 'Final Bonus', 'Managers']));
  const byLocation = new Map<string, ManagerRow[]>();
  rows.forEach(row => byLocation.set(shortLocation(row.location), [...(byLocation.get(shortLocation(row.location)) || []), row]));
  TEMPLATE_LOCATIONS.forEach(label => {
    const bucket = byLocation.get(label) || [];
    if (!bucket.length && label !== 'Unassigned / Other') return;
    const summary = totals(bucket);
    const row = sheet.addRow([label, summary.hours, summary.original, summary.final, summary.managers]);
    row.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:LOCATION_COLORS[label] || LOCATION_COLORS.Unknown } };
    });
  });
  sheet.getColumn(4).numFmt = '#,##0.00';
  [5,10,11,12].forEach(col => sheet.getColumn(col).numFmt = '"$"#,##0.00');
  [6,9].forEach(col => sheet.getColumn(col).numFmt = '0.0%');
  sheet.autoFilter = { from:'A3', to:'M3' };
  sheet.views = [{ state:'frozen', ySplit:3 }];
}

function addBonusLog(workbook: ExcelJS.Workbook, currentRows: ManagerRow[], monthlyRows: Record<string, ManagerRow[]>, selectedMonth: string) {
  const sheet = workbook.addWorksheet('Bonus Log');
  sheet.columns = [
    { width:14 }, { width:30 }, { width:24 }, { width:18 }, { width:14 },
    { width:16 }, { width:13 }, { width:12 }, { width:12 }, { width:15 }, { width:12 },
  ];
  styleTitle(sheet, 'A1:K1', 'Bonus Log — Monthly History');
  sheet.getCell('A2').value = 'Generated export. Current rows mirror All Managers; archive rows below preserve closed/past months included in this workbook.';
  sheet.mergeCells('A2:K2');
  styleHeader(sheet.addRow([]));
  styleHeader(sheet.addRow(['Period','Name','Location','Role','Worked Hours','Original Bonus','Pool % Used','Total Points','Score %','Final Bonus','Source']));
  currentRows.forEach(row => sheet.addRow([selectedMonth,row.employee_name,shortLocation(row.location),row.role || row.department || 'Manager',row.worked_hours,row.original_bonus,(row.bonus_pool || DEFAULT_MANAGER_BONUS_POOL)/100,row.totalPoints,row.scorePercent,row.finalBonus,'Current']));
  sheet.addRow(['LIVE — selected month rows above']);
  sheet.addRow(['ARCHIVE — past/full-month rows below']);
  Object.entries(monthlyRows).forEach(([month, rows]) => {
    if (month === selectedMonth) return;
    rows.forEach(row => sheet.addRow([month,row.employee_name,shortLocation(row.location),row.role || row.department || 'Manager',row.worked_hours,row.original_bonus,(row.bonus_pool || DEFAULT_MANAGER_BONUS_POOL)/100,row.totalPoints,row.scorePercent,row.finalBonus,'Archive']));
  });
  sheet.getColumn(5).numFmt = '#,##0.00';
  [6,10].forEach(col => sheet.getColumn(col).numFmt = '"$"#,##0.00');
  [7,9].forEach(col => sheet.getColumn(col).numFmt = '0.0%');
  sheet.autoFilter = { from:'A4', to:'K4' };
  sheet.views = [{ state:'frozen', ySplit:4 }];
}

function addMonthlySummary(workbook: ExcelJS.Workbook, monthlyRows: Record<string, ManagerRow[]>, months: string[]) {
  const sheet = workbook.addWorksheet('Monthly Summary');
  sheet.columns = [{ width:22 }, ...months.map(() => ({ width:14 })), { width:15 }];
  styleTitle(sheet, `A1:${sheet.getColumn(months.length + 2).letter}1`, 'Monthly Summary — Final Bonus by Location');
  sheet.getCell('A2').value = 'Final bonus by location. Columns follow the month filter calendar from Settings.';
  sheet.mergeCells(`A2:${sheet.getColumn(months.length + 2).letter}2`);
  styleHeader(sheet.addRow([]));
  styleHeader(sheet.addRow(['Location', ...months.map(monthLabel), 'Total']));
  TEMPLATE_LOCATIONS.forEach(label => {
    const values = months.map(month => {
      const bucket = (monthlyRows[month] || []).filter(row => shortLocation(row.location) === label);
      return totals(bucket).final;
    });
    const row = sheet.addRow([label, ...values, values.reduce((a,b)=>a+b,0)]);
    row.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:LOCATION_COLORS[label] || LOCATION_COLORS.Unknown } };
    });
  });
  const allValues = months.map(month => totals(monthlyRows[month] || []).final);
  const totalRow = sheet.addRow(['All Locations', ...allValues, allValues.reduce((a,b)=>a+b,0)]);
  totalRow.font = { bold:true };
  totalRow.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.gold } };
  for (let col = 2; col <= months.length + 2; col++) sheet.getColumn(col).numFmt = '"$"#,##0.00';
  sheet.views = [{ state:'frozen', ySplit:4, xSplit:1 }];
}

function addDashboard(workbook: ExcelJS.Workbook, rows: ManagerRow[], monthlyRows: Record<string, ManagerRow[]>, months: string[], selectedMonth: string, start: string, end: string, locationFilter: string) {
  const sheet = workbook.addWorksheet('Dashboard');
  sheet.columns = Array.from({ length:12 }, () => ({ width:18 }));
  styleTitle(sheet, 'A1:J1', 'Manager Bonus Plan — Dashboard');
  sheet.getCell('A2').value = 'Selected month, period, and location filter are shown below. Tables mirror the Manager Bonus template.';
  sheet.mergeCells('A2:J2');
  sheet.addRow([]);
  sheet.addRow(['Month Shown', selectedMonth, '← month filter', '', '', 'Period', `${start} → ${end}`, '', 'Location Filter', locationFilter || 'All locations']);
  ['B4','G4','J4'].forEach(address => styleInput(sheet.getCell(address)));
  sheet.addRow(['Previous Month', months[Math.max(0, months.indexOf(selectedMonth) - 1)] || '— none —', '', '', '', 'Program Default Pool %', DEFAULT_MANAGER_BONUS_POOL / 100]);
  setPercent(sheet.getCell('G5'));
  sheet.addRow([]);
  const summary = totals(rows);
  const previousMonth = months[Math.max(0, months.indexOf(selectedMonth) - 1)] || '';
  const previousTotal = previousMonth ? totals(monthlyRows[previousMonth] || []).final : 0;
  const cards = [
    ['Total Bonus — Month Shown', summary.final],
    ['Total Bonus — Previous Month', previousTotal],
    ['Change vs Previous Month', summary.final - previousTotal],
    ['Avg Score % — Live Scorecards', summary.max ? summary.points / summary.max : 0],
  ];
  styleHeader(sheet.getRow(7));
  cards.forEach((card, index) => {
    const col = 1 + index * 3;
    sheet.mergeCells(7, col, 7, col + 1);
    sheet.mergeCells(8, col, 9, col + 1);
    sheet.getCell(7, col).value = card[0];
    sheet.getCell(8, col).value = card[1];
    sheet.getCell(7, col).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.deep } };
    sheet.getCell(7, col).font = { bold:true, color:{ argb:BRAND.white } };
    sheet.getCell(8, col).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.deep } };
    sheet.getCell(8, col).font = { bold:true, size:18, color:{ argb:BRAND.gold } };
    if (index < 3) setCurrency(sheet.getCell(8, col)); else setPercent(sheet.getCell(8, col));
  });

  sheet.addRow([]);
  sheet.addRow(['Final Bonus by Manager', '', '', '', '', 'Final Bonus by Location']);
  styleHeader(sheet.addRow(['Name','Previous','Month Shown','Change','','Location','Previous','Month Shown','Change']));
  rows.slice(0, 25).forEach(row => {
    const prev = previousMonth ? totals((monthlyRows[previousMonth] || []).filter(item => item.employee_name === row.employee_name)).final : 0;
    sheet.addRow([row.employee_name, prev, row.finalBonus, row.finalBonus - prev, '', shortLocation(row.location), '', '', '']);
  });
  const managerTotalRow = sheet.addRow(['Total', '', summary.final, '', '', 'Total', previousTotal, summary.final, summary.final - previousTotal]);
  managerTotalRow.font = { bold:true };
  managerTotalRow.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.gold } };

  const locationStart = 13;
  TEMPLATE_LOCATIONS.forEach((label, index) => {
    const rowNumber = locationStart + index;
    const prev = previousMonth ? totals((monthlyRows[previousMonth] || []).filter(row => shortLocation(row.location) === label)).final : 0;
    const current = totals(rows.filter(row => shortLocation(row.location) === label)).final;
    sheet.getCell(rowNumber, 6).value = label;
    sheet.getCell(rowNumber, 7).value = prev;
    sheet.getCell(rowNumber, 8).value = current;
    sheet.getCell(rowNumber, 9).value = current - prev;
    [6,7,8,9].forEach(col => {
      sheet.getCell(rowNumber, col).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:LOCATION_COLORS[label] || LOCATION_COLORS.Unknown } };
    });
  });

  sheet.addRow([]);
  sheet.addRow(['Monthly Trend — Total Final Bonus, All Locations']);
  styleHeader(sheet.addRow(['Month','Total Final Bonus','Change vs Prior']));
  months.forEach((month, index) => {
    const current = totals(monthlyRows[month] || []).final;
    const previous = index > 0 ? totals(monthlyRows[months[index - 1]] || []).final : 0;
    sheet.addRow([month, current, index === 0 ? '—' : current - previous]);
  });
  ['B','C','G','H','I'].forEach(col => sheet.getColumn(col).numFmt = '"$"#,##0.00');
  sheet.views = [{ state:'frozen', ySplit:1 }];
}

function addManagerSheet(workbook: ExcelJS.Workbook, manager: ManagerRow, start: string, end: string, name?: string) {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, name || manager.employee_name));
  sheet.columns = [{ width:34 }, { width:18 }, { width:14 }, { width:36 }, { width:70 }];
  styleTitle(sheet, 'A1:D1', 'Manager Bonus Review');
  sheet.addRow(['Period', `${start} to ${end}`, '← generated from CM Pay Manager Bonus export']);
  sheet.addRow(['Name', manager.employee_name]);
  sheet.addRow(['Location', manager.location]);
  sheet.addRow(['Role', managerBonusTrack(manager.department, manager.role)]);
  sheet.addRow(['Worked Hours', Number(manager.worked_hours || 0)]);
  sheet.addRow(['Original Bonus ($)', Number(manager.original_bonus || 0)]);
  sheet.addRow(['Bonus Pool Override %', '', '← leave blank to use the program default']);
  sheet.addRow(['Effective Pool %', Number(manager.bonus_pool || DEFAULT_MANAGER_BONUS_POOL) / 100]);
  ['B3','B4','B5','B6','B7'].forEach(address => styleInput(sheet.getCell(address)));
  sheet.addRow([]);
  styleHeader(sheet.addRow(['Category', 'Rating (0–5)', 'Max', 'Notes', 'What to review']));
  const rubric = rubricForManager(manager.department, manager.role);
  rubric.forEach((item, index) => sheet.addRow([
    item.label,
    manager.rubric_ratings?.[index] ?? '',
    5,
    '',
    item.description,
  ]));
  sheet.addRow([]);
  sheet.addRow(['Total Points', Number(manager.totalPoints || 0)]);
  sheet.addRow(['Max Points', Number(manager.max_points || 50)]);
  sheet.addRow(['Score %', Number(manager.scorePercent || 0)]);
  sheet.addRow(['Max Extra ($)', Number(manager.maxExtraBonus || 0)]);
  sheet.addRow(['Earned Extra Bonus', Number(manager.earnedExtraBonus || 0)]);
  const finalRow = sheet.addRow(['Final Bonus Payout', Number(manager.finalBonus || 0)]);
  finalRow.font = { bold:true };
  finalRow.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:BRAND.gold } };
  sheet.addRow([]);
  sheet.addRow(['Approved By', manager.approval || '']);
  sheet.addRow(['Date', '']);
  sheet.getColumn(2).numFmt = '#,##0.00';
  [7,26,27,28].forEach(row => setCurrency(sheet.getCell(row, 2)));
  setPercent(sheet.getCell('B9'));
  setPercent(sheet.getCell('B25'));
  sheet.autoFilter = { from:'A11', to:'E11' };
  sheet.views = [{ state:'frozen', ySplit:11 }];
}

async function buildMonthlyRows(selectedMonth: string, location: string, employeeId: string) {
  const year = Number(selectedMonth.slice(0, 4));
  const months = Array.from({ length:12 }, (_, index) => monthKey(new Date(year, index, 1)));
  const monthlyRows: Record<string, ManagerRow[]> = {};
  for (const month of months) {
    const range = monthRange(month);
    const { rows } = await getManagerBonusRows(range.start, range.end, location);
    monthlyRows[month] = rows.filter((row: ManagerRow) => (!location || row.location === location) && (!employeeId || row.employee_id === employeeId));
  }
  return { months, monthlyRows };
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const start = params.get('start') || '';
    const end = params.get('end') || '';
    const location = params.get('location') || '';
    const employeeId = params.get('employee_id') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error:'Valid dates are required' }, { status:400 });

    const selectedMonth = parseMonthFromStart(start);
    const { rows } = await getManagerBonusRows(start, end, location);
    const selected = rows.filter((row: ManagerRow) => (!location || row.location === location) && (!employeeId || row.employee_id === employeeId));
    if (!selected.length) return NextResponse.json({ error:'No managers found for this report' }, { status:404 });
    const { months, monthlyRows } = await buildMonthlyRows(selectedMonth, location, employeeId);
    monthlyRows[selectedMonth] = selected;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CM Pay';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    addDashboard(workbook, selected, monthlyRows, months, selectedMonth, start, end, location);
    addAllManagers(workbook, selected);
    addMonthlySummary(workbook, monthlyRows, months);
    addBonusLog(workbook, selected, monthlyRows, selectedMonth);
    addSettings(workbook, selectedMonth, location, months);
    selected.forEach((row: ManagerRow, index: number) => addManagerSheet(workbook, row, start, end, employeeId ? 'Manager Bonus' : `${index + 1}-${row.employee_name}`));

    workbook.worksheets.forEach(sheet => {
      sheet.eachRow(row => {
        row.eachCell(cell => {
          cell.alignment = { ...(cell.alignment || {}), vertical:'middle', wrapText:true };
          cell.border = {
            top:{ style:'thin', color:{ argb:'FFE5E7EB' } },
            left:{ style:'thin', color:{ argb:'FFE5E7EB' } },
            bottom:{ style:'thin', color:{ argb:'FFE5E7EB' } },
            right:{ style:'thin', color:{ argb:'FFE5E7EB' } },
          };
        });
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const suffix = employeeId ? selected[0].employee_name : (location || 'All_Locations');
    const filter = `${selectedMonth}_${periodLabel(start, end).replace(/[^a-z0-9]+/gi, '_')}`;
    return new NextResponse(buffer as any, {
      headers:{
        'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':`attachment; filename="Manager_Bonus_${suffix.replace(/[^a-z0-9]+/gi,'_')}_${filter}.xlsx"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}
