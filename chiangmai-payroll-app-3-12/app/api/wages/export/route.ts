import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { firstPayrollPeriodEnd, isNewEmployee } from '@/lib/employee-status';
import { applyCashWage } from '@/lib/cash-rates';

const PAGE = 1000;
const green = 'FF087866';
const purple = 'FFA78BFA';
const cyan = 'FFDCFCE7';
const yellow = 'FFFFF3C4';
const red = 'FFFFE4E6';
const darkText = 'FF111827';

async function fetchAll(makeQuery: (from: number, to: number) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function header(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 28;
}

function moneyColumn(sheet: ExcelJS.Worksheet, columns: number[]) {
  columns.forEach(column => { sheet.getColumn(column).numFmt = '$0.00'; });
}

function finishSheet(sheet: ExcelJS.Worksheet, headerRow = 3) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 1 }];
  const lastColumn = sheet.columnCount || 1;
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: lastColumn },
  };
  sheet.eachRow(row => {
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });
}

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function normName(value: string) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function safeName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, '').slice(0, 80) || 'ALL';
}

function matchesFilters(employee: any, options: { search: string; location: string; missingOnly: boolean }) {
  if (options.location && options.location !== 'ALL' && employee.location !== options.location) return false;
  if (options.search && !clean(employee.full_name).toLowerCase().includes(options.search.toLowerCase())) return false;
  if (options.missingOnly && Number(employee.wage || 0) > 0) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = clean(params.get('search'));
    const location = clean(params.get('location') || 'ALL') || 'ALL';
    const missingOnly = params.get('missingOnly') === 'true';
    const supabase = getSupabaseAdmin();

    const [employeeRows, ruleRows, historyRows] = await Promise.all([
      fetchAll((from, to) => supabase
        .from('employees')
        .select('id,employee_id,seven_shifts_user_id,full_name,location,department,role,wage,cash_wage,wage_locked,wage_source,active,created_at')
        .eq('active', true)
        .order('full_name')
        .range(from, to)),
      fetchAll((from, to) => supabase
        .from('employee_rules')
        .select('*')
        .eq('active', true)
        .order('employee_name')
        .range(from, to)),
      fetchAll((from, to) => supabase
        .from('employee_wage_history')
        .select('employee_id,seven_shifts_user_id,employee_name,location,department,role,old_wage,new_wage,effective_date,detected_at,source,notes,created_at')
        .order('effective_date', { ascending: false, nullsFirst: false })
        .order('detected_at', { ascending: false })
        .range(from, to)).catch(async (error) => {
          if (/employee_wage_history|schema cache|does not exist/i.test(error.message || '')) return [];
          throw error;
        }),
    ]);

    const employees = employeeRows
      .map(fillMissingRosterDetails)
      .map(applyCashWage)
      .map((employee: any) => ({
        ...employee,
        is_new: isNewEmployee(employee.created_at),
        new_until: firstPayrollPeriodEnd(employee.created_at),
      }))
      .filter(employee => matchesFilters(employee, { search, location, missingOnly }));
    const employeeNames = new Set(employees.map(employee => normName(employee.full_name)));
    const employeeIds = new Set(employees.map(employee => employee.employee_id).filter(Boolean));
    const rules = ruleRows.filter(rule => {
      if (location === 'ALL' && !search && !missingOnly) return true;
      return employeeNames.has(normName(rule.employee_name || '')) || employeeIds.has(rule.employee_id);
    });
    const history = historyRows.filter(row => {
      if (location !== 'ALL' && row.location !== location) return false;
      if (search && !clean(row.employee_name).toLowerCase().includes(search.toLowerCase())) return false;
      if (missingOnly && !employeeIds.has(row.employee_id)) return false;
      return true;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CM Pay';
    workbook.created = new Date();
    workbook.modified = new Date();

    const filterText = `Filters: location=${location}; search=${search || 'none'}; missing wage only=${missingOnly ? 'yes' : 'no'}; exported=${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

    const wages = workbook.addWorksheet('Wages');
    wages.mergeCells('A1:N1');
    wages.getCell('A1').value = 'CM Pay Employee Wages';
    wages.getCell('A1').font = { bold: true, size: 16, color: { argb: darkText } };
    wages.mergeCells('A2:N2');
    wages.getCell('A2').value = filterText;
    wages.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };
    const wageHeader = wages.addRow(['Employee','Location','Department','Role','Cheque Wage','Cash Wage','Wage Source','Wage Locked','New Employee','New Until','Active','7shifts User ID','Employee ID','Review Notes']);
    header(wageHeader);
    employees.forEach(employee => {
      const row = wages.addRow([
        employee.full_name,
        employee.location || '',
        employee.department || '',
        employee.role || '',
        Number(employee.wage || 0),
        Number(employee.cash_wage || 0),
        employee.wage_source || '',
        employee.wage_locked ? 'Yes' : 'No',
        employee.is_new ? 'NEW' : '',
        employee.new_until || '',
        employee.active === false ? 'No' : 'Yes',
        employee.seven_shifts_user_id || '',
        employee.employee_id || '',
        employee.is_new ? `New through ${employee.new_until || 'first payroll period'}` : '',
      ]);
      if (Number(employee.wage || 0) <= 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } };
      if (employee.is_new) row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cyan } };
      if (employee.wage_source === '7shifts-upgraded') row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: yellow } };
    });
    wages.columns = [30,26,20,22,13,13,18,12,13,14,10,18,18,45].map(width => ({ width }));
    moneyColumn(wages, [5,6]);
    finishSheet(wages);

    const rulesSheet = workbook.addWorksheet('Employee Rules');
    rulesSheet.mergeCells('A1:K1');
    rulesSheet.getCell('A1').value = 'CM Pay Employee Payroll Rules';
    rulesSheet.getCell('A1').font = { bold: true, size: 16, color: { argb: darkText } };
    rulesSheet.mergeCells('A2:K2');
    rulesSheet.getCell('A2').value = `${filterText}; rule rows shown for employees matching the Wages filter`;
    rulesSheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };
    header(rulesSheet.addRow(['Employee','Rule Type','Rule Value','Combined Locations','Payroll Location','Effective From','Effective To','Active','Notes','Employee ID','Rule ID']));
    rules.forEach(rule => {
      const row = rulesSheet.addRow([
        rule.employee_name || '',
        String(rule.rule_type || '').replaceAll('_', ' '),
        rule.rule_value ?? '',
        rule.combined_locations || '',
        rule.payroll_location || '',
        rule.effective_from || '',
        rule.effective_to || '',
        rule.active === false ? 'No' : 'Yes',
        rule.notes || '',
        rule.employee_id || '',
        rule.id || '',
      ]);
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      row.getCell(2).font = { bold: true, color: { argb: purple } };
    });
    rulesSheet.columns = [30,24,13,34,26,14,14,10,60,18,36].map(width => ({ width }));
    finishSheet(rulesSheet);

    const historySheet = workbook.addWorksheet('Wage History');
    historySheet.mergeCells('A1:O1');
    historySheet.getCell('A1').value = 'CM Pay Wage History';
    historySheet.getCell('A1').font = { bold: true, size: 16, color: { argb: darkText } };
    historySheet.mergeCells('A2:O2');
    historySheet.getCell('A2').value = `${filterText}; exact effective dates depend on what 7shifts provides`;
    historySheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };
    header(historySheet.addRow(['Employee','Location','Department','Role','Old Wage','New Wage','Increase','Effective Date','Detected At','Source','Notes','7shifts User ID','Employee ID','Created At','Change Type']));
    history.forEach(item => {
      const oldWage = Number(item.old_wage || 0);
      const newWage = Number(item.new_wage || 0);
      const row = historySheet.addRow([
        item.employee_name || '',
        item.location || '',
        item.department || '',
        item.role || '',
        oldWage,
        newWage,
        Math.round((newWage - oldWage) * 100) / 100,
        item.effective_date || '',
        item.detected_at ? new Date(item.detected_at) : '',
        item.source || '',
        item.notes || '',
        item.seven_shifts_user_id || '',
        item.employee_id || '',
        item.created_at ? new Date(item.created_at) : '',
        newWage > oldWage ? 'Increase' : newWage < oldWage ? 'Decrease/Correction' : 'Recorded Rate',
      ]);
      if (newWage > oldWage) row.getCell(15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cyan } };
      if (newWage < oldWage) row.getCell(15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } };
    });
    historySheet.columns = [30,26,20,22,13,13,13,14,20,22,65,18,18,20,18].map(width => ({ width }));
    moneyColumn(historySheet, [5,6,7]);
    historySheet.getColumn(8).numFmt = 'yyyy-mm-dd';
    historySheet.getColumn(9).numFmt = 'yyyy-mm-dd hh:mm';
    historySheet.getColumn(14).numFmt = 'yyyy-mm-dd hh:mm';
    finishSheet(historySheet);

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="CM_Pay_Wages_Rules_History_${safeName(location)}_${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
