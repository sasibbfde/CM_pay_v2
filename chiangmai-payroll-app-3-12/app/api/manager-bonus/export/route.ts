import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getManagerBonusRows } from '@/lib/manager-bonus-data';
import { rubricForManager } from '@/lib/manager-bonus';

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
  [['Period',`${start} to ${end}`],['Location',manager.location],['Role',manager.role || manager.department || 'Manager'],['Hourly Rate',manager.wage || 0],['7shifts Hours',manager.seven_shifts_hours],['Additional Hours',manager.manual_hours],['Total Worked Hours',manager.worked_hours],['Original Bonus',manager.original_bonus],['Bonus Pool %',manager.bonus_pool],['Points Possible',manager.max_points],['Max Extra Bonus',manager.maxExtraBonus],['Final Bonus Payout',manager.finalBonus]].forEach(values => sheet.addRow(values));
  sheet.addRow([]);
  const header = sheet.addRow(['Performance Area','Rating 0–5','Max Points','Notes']); styleHeader(header, 'FF14857E');
  const rubric = rubricForManager(manager.department, manager.role);
  rubric.forEach((item, index) => sheet.addRow([item.label, manager.rubric_ratings?.[index] ?? '', 5, item.description]));
  sheet.addRow([]);
  sheet.addRow(['Total Points',manager.totalPoints]);
  sheet.addRow(['Score %',manager.scorePercent]);
  sheet.addRow(['Earned Extra Bonus',manager.earnedExtraBonus]);
  sheet.addRow(['Final Bonus',manager.finalBonus]);
  sheet.addRow(['Approval',manager.approval || '']);
  sheet.getColumn(2).numFmt = '#,##0.00';
  sheet.getColumn(2).numFmt = '#,##0.00';
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
    const { rows } = await getManagerBonusRows(start, end, location);
    const selected = rows.filter((row:any) => (!location || row.location === location) && (!employeeId || row.employee_id === employeeId));
    if (!selected.length) return NextResponse.json({ error:'No managers found for this report' }, { status:404 });

    const workbook = new ExcelJS.Workbook(); workbook.creator = 'CM Pay';
    if (employeeId && selected.length === 1) addManagerSheet(workbook, selected[0], start, end, 'Manager Bonus');
    else {
      const summary = workbook.addWorksheet('Location Summary');
      summary.columns = [
        {header:'Manager',width:30},{header:'Location',width:24},{header:'Role',width:20},{header:'Hourly Rate',width:12},{header:'7shifts Hours',width:14},{header:'Added Hours',width:12},{header:'Total Hours',width:12},
        {header:'Original Bonus',width:16},{header:'Bonus Pool %',width:13},{header:'Points',width:10},{header:'Points Possible',width:15},{header:'Score %',width:12},
        ...Array.from({length:10},(_,index)=>({header:`Rating ${index+1}`,width:14})),
        {header:'Extra Bonus',width:15},{header:'Final Payout',width:15},{header:'Approval',width:18},
      ];
      styleHeader(summary.getRow(1));
      selected.forEach((row:any) => summary.addRow([
        row.employee_name,row.location,row.role || row.department || 'Manager',row.wage || 0,row.seven_shifts_hours,row.manual_hours,row.worked_hours,
        row.original_bonus,row.bonus_pool,row.totalPoints,row.max_points,row.scorePercent,
        ...Array.from({length:10},(_,index)=>row.rubric_ratings?.[index] ?? ''),
        row.earnedExtraBonus,row.finalBonus,row.approval || '',
      ]));
      summary.getColumn(4).numFmt = '$#,##0.00'; summary.getColumn(8).numFmt = '$#,##0.00'; summary.getColumn(12).numFmt = '0%'; summary.getColumn(23).numFmt = '$#,##0.00'; summary.getColumn(24).numFmt = '$#,##0.00';
      summary.views = [{ state:'frozen', ySplit:1 }]; summary.autoFilter = { from:'A1', to:'Y1' };
      selected.forEach((row:any, index:number) => addManagerSheet(workbook, row, start, end, `${index+1}-${row.employee_name}`));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const suffix = employeeId ? selected[0].employee_name : (location || 'All_Locations');
    return new NextResponse(buffer as any, { headers:{ 'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition':`attachment; filename="Manager_Bonus_${suffix.replace(/[^a-z0-9]+/gi,'_')}_${start}_${end}.xlsx"` } });
  } catch (error:any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}
