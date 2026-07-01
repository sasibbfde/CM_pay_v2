import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getManagerBonusRows } from '@/lib/manager-bonus-data';

const categoryColumns = [
  ['Attendance','attendance'], ['Inventory','inventory'], ['Cleaning','cleaning'],
  ['Labour Control','labour_control'], ['Customer Service / Leadership','customer_service_leadership'],
] as const;

function styleHeader(row: ExcelJS.Row, color = 'FF1F4E78') {
  row.font = { bold:true, color:{ argb:'FFFFFFFF' } };
  row.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:color } };
  row.alignment = { vertical:'middle' };
}

function addManagerSheet(workbook: ExcelJS.Workbook, manager: any, start: string, end: string, name?: string) {
  const sheet = workbook.addWorksheet((name || manager.employee_name).replace(/[\\/*?:\[\]]/g,'').slice(0,31));
  sheet.columns = [{ width:34 },{ width:18 },{ width:14 },{ width:48 }];
  sheet.mergeCells('A1:D1'); sheet.getCell('A1').value = `Manager Bonus Review — ${manager.employee_name}`; styleHeader(sheet.getRow(1)); sheet.getRow(1).height = 26;
  sheet.addRow([]);
  [['Period',`${start} to ${end}`],['Location',manager.location],['Role',manager.role || manager.department || 'Manager'],['Worked Hours',manager.worked_hours],['Original Bonus',manager.original_bonus],['Max Extra Bonus (50%)',manager.maxExtraBonus],['Final Bonus Payout',manager.finalBonus]].forEach(values => sheet.addRow(values));
  sheet.addRow([]);
  const header = sheet.addRow(['Performance Area','Rating 0–5','Max Points','Notes']); styleHeader(header, 'FF14857E');
  categoryColumns.forEach(([label,key]) => sheet.addRow([label, manager[key] ?? '', 5, manager.notes || '']));
  sheet.addRow([]);
  sheet.addRow(['Total Points',manager.totalPoints]);
  sheet.addRow(['Score %',manager.scorePercent]);
  sheet.addRow(['Earned Extra Bonus',manager.earnedExtraBonus]);
  sheet.addRow(['Final Bonus',manager.finalBonus]);
  sheet.addRow(['Approval',manager.approval || '']);
  sheet.getColumn(2).numFmt = '#,##0.00';
  sheet.getCell('B19').numFmt = '0%';
  for (const address of ['B7','B8','B9','B20','B21']) sheet.getCell(address).numFmt = '$#,##0.00';
  sheet.views = [{ state:'frozen', ySplit:1 }];
  return sheet;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const start = params.get('start') || '';
    const end = params.get('end') || '';
    const location = params.get('location') || '';
    const employeeId = params.get('employee_id') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return NextResponse.json({ error:'Valid dates are required' }, { status:400 });
    const { rows } = await getManagerBonusRows(start, end);
    const selected = rows.filter((row:any) => (!location || row.location === location) && (!employeeId || row.employee_id === employeeId));
    if (!selected.length) return NextResponse.json({ error:'No managers found for this report' }, { status:404 });

    const workbook = new ExcelJS.Workbook(); workbook.creator = 'CM Pay';
    if (employeeId && selected.length === 1) addManagerSheet(workbook, selected[0], start, end, 'Manager Bonus');
    else {
      const summary = workbook.addWorksheet('Location Summary');
      summary.columns = [{header:'Manager',width:30},{header:'Location',width:24},{header:'Hours',width:12},{header:'Original Bonus',width:16},...categoryColumns.map(([label])=>({header:label,width:16})),{header:'Points',width:10},{header:'Score %',width:12},{header:'Extra Bonus',width:15},{header:'Final Payout',width:15},{header:'Approval',width:18}];
      styleHeader(summary.getRow(1));
      selected.forEach((row:any) => summary.addRow([row.employee_name,row.location,row.worked_hours,row.original_bonus,...categoryColumns.map(([,key])=>row[key] ?? ''),row.totalPoints,row.scorePercent,row.earnedExtraBonus,row.finalBonus,row.approval || '']));
      summary.getColumn(4).numFmt = '$#,##0.00'; summary.getColumn(11).numFmt = '0%'; summary.getColumn(12).numFmt = '$#,##0.00'; summary.getColumn(13).numFmt = '$#,##0.00';
      summary.views = [{ state:'frozen', ySplit:1 }]; summary.autoFilter = { from:'A1', to:'N1' };
      selected.forEach((row:any, index:number) => addManagerSheet(workbook, row, start, end, `${index+1}-${row.employee_name}`));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const suffix = employeeId ? selected[0].employee_name : (location || 'All_Locations');
    return new NextResponse(buffer as any, { headers:{ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition':`attachment; filename="Manager_Bonus_${suffix.replace(/[^a-z0-9]+/gi,'_')}_${start}_${end}.xlsx"` } });
  } catch (error:any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}
