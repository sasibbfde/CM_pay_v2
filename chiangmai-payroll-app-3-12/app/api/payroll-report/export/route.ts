import { NextRequest,NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { payrollLocationView, summarizePayrollReport } from '@/lib/payroll-report';
import { ontarioHolidayLabel } from '@/lib/ontario-holidays';

const green='FF087866',light='FFD7F0EC',orange='FFFFE0B2',yellow='FFFFF176',red='FFFFCDD2';
const cyan='FFDFFBFF',purple='FFEDE9FE',wageGreen='FFD1FAE5',warningRed='FFFFE4E6';
function header(row:ExcelJS.Row){row.font={bold:true,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:green}};row.alignment={vertical:'middle',wrapText:true};row.height=34;}
function changeLabels(row:any){return (row.employee_labels||[]).join(', ');}
function multiLocationLabel(row:any){return row.locations?.length>1?'MULTI-LOCATION — split by worked location':'';}
function locationHourBreakdown(row:any){
  return row.locations?.length>1
    ? row.locations.map((name:string)=>`${name}: actual ${(Number(row.location_gross_hours?.[name]||0)).toFixed(2)}h / payable ${(Number(row.location_hours?.[name]||0)).toFixed(2)}h${row.location_holiday_hours?.[name]?` / holiday ${(Number(row.location_holiday_hours[name]||0)).toFixed(2)}h`:''}`).join(' · ')
    : '';
}
function applyChangeHighlights(excelRow:ExcelJS.Row,row:any,columns:{employee?:number;role?:number;wage?:number;labels?:number;notes?:number}){
  const labels=row.employee_labels||[];
  if(!labels.length)return;
  const over14=labels.includes('OVER 14.2H');
  if(labels.includes('NEW')){
    excelRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:cyan}};
    if(columns.employee)excelRow.getCell(columns.employee).font={bold:true,color:{argb:'FF0E7490'}};
  }
  if(over14){
    excelRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:warningRed}};
    if(columns.employee)excelRow.getCell(columns.employee).font={bold:true,color:{argb:'FFB91C1C'}};
  }
  if(labels.includes('WAGE ↑')&&columns.wage){
    excelRow.getCell(columns.wage).fill={type:'pattern',pattern:'solid',fgColor:{argb:wageGreen}};
    excelRow.getCell(columns.wage).font={bold:true,color:{argb:'FF047857'}};
  }
  if(labels.includes('POSITION CHANGED')&&columns.role){
    excelRow.getCell(columns.role).fill={type:'pattern',pattern:'solid',fgColor:{argb:purple}};
    excelRow.getCell(columns.role).font={bold:true,color:{argb:'FF6D28D9'}};
  }
  for(const column of [columns.labels,columns.notes].filter(Boolean) as number[]){
    excelRow.getCell(column).fill={type:'pattern',pattern:'solid',fgColor:{argb:over14?warningRed:labels.includes('NEW')?cyan:labels.includes('WAGE ↑')?wageGreen:purple}};
    excelRow.getCell(column).font={bold:true,color:{argb:over14?'FFB91C1C':labels.includes('NEW')?'FF0E7490':labels.includes('WAGE ↑')?'FF047857':'FF6D28D9'}};
  }
}
function addMerged(workbook:ExcelJS.Workbook,rows:any[],start:string,end:string){
  const holidayLabel=ontarioHolidayLabel(start,end);
  const sheet=workbook.addWorksheet('ALL (Merged)');sheet.mergeCells('A1:AA1');sheet.getCell('A1').value=`ALL LOCATIONS MERGED — ${start} to ${end}`;sheet.getCell('A1').font={bold:true,size:15};
  sheet.mergeCells('A2:AA2');sheet.getCell('A2').value='Payroll authority: completed 7shifts punches only. Payable total still reconciles to 7shifts; Ontario public-holiday hours are separated. Multi-location employees are labelled and their hours stay with the location where they clocked in/out, because separate location payrolls/cheques are run. Holiday pay is capped to 8h and consumes the cheque cap, so regular cheque hours are reduced before excess hours move to cash. NEW, WAGE ↑, POSITION CHANGED, and OVER 14.2H labels are highlighted for payroll review.';sheet.getCell('A2').font={italic:true,color:{argb:'FF666666'}};
  const labels=['#','Employee','Location(s)','Role(s)','Rate ($/hr)','Gross Clock Hours','Break Hours (all)','Unpaid Break Hours','Payable Hours Total',`Regular Payable Hours (excl ${holidayLabel})`,`Holiday Hours (${holidayLabel})`,'Rounded Regular Hours (0.25h)','Cheque Hours','Cash Hours','Cheque Pay ($)','Cash Pay ($)','Holiday Premium Pay (1.5x)','Total Pay ($)','Status','Notes','Rule Type','Cheque Cap','Rule Value','Cash Rate ($/hr)','Change Labels','Multi-location Label','Location Hour Breakdown'];
  sheet.addRow([]);const top=sheet.addRow(labels);header(top);
  rows.forEach((row,index)=>{const labelNotes=[(row.employee_labels||[]).length?`Labels: ${(row.employee_labels||[]).join(', ')}`:'',row.wage_change_note,row.detail_change_note,row.notes].filter(Boolean).join('; ');const excelRow=sheet.addRow([index+1,row.employee_name,row.locations.join('; '),row.roles.join(', '),row.wage,row.gross_hours,row.break_hours,row.unpaid_break_hours,row.payable_hours,row.regular_payable_hours,row.holiday_hours,null,null,null,null,null,row.holiday_pay,null,row.status,labelNotes,row.rule_type,row.cheque_cap,row.rule_value,row.cash_wage,changeLabels(row),multiLocationLabel(row),locationHourBreakdown(row)]);const n=excelRow.number;
    excelRow.getCell(12).value={formula:`ROUND(J${n}*4,0)/4`,result:row.rounded_hours};
    excelRow.getCell(13).value={formula:`IF(OR(U${n}="CASH_ONLY",U${n}="HOLD_PAYROLL"),0,IF(U${n}="SALARY_FIXED",L${n},MIN(L${n},MAX(0,V${n}-MIN(K${n},8,V${n})))))`,result:row.cheque_hours};
    excelRow.getCell(14).value={formula:`IF(OR(U${n}="HOLD_PAYROLL",U${n}="SALARY_FIXED"),0,IF(U${n}="CASH_ONLY",L${n}+K${n},(L${n}-M${n})+MAX(0,K${n}-MIN(K${n},8,V${n}))))`,result:row.cash_hours};
    excelRow.getCell(15).value={formula:`IF(U${n}="SALARY_FIXED",W${n},ROUND(M${n}*E${n},2))`,result:row.cheque_pay};
    excelRow.getCell(16).value={formula:`ROUND(N${n}*X${n},2)`,result:row.cash_pay};
    excelRow.getCell(17).value={formula:`IF(OR(U${n}="CASH_ONLY",U${n}="HOLD_PAYROLL",U${n}="SALARY_FIXED"),0,ROUND(MIN(K${n},8,V${n})*E${n}*1.5,2))`,result:row.holiday_pay};
    excelRow.getCell(18).value={formula:`O${n}+P${n}+Q${n}`,result:row.total_pay};
    if(row.status.includes('HOLD'))excelRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:red}};else if(row.status.includes('CASH')||row.status.includes('Exception'))excelRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:yellow}};else if(row.cash_hours>0)excelRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:orange}};
    if(row.locations.length>1){excelRow.getCell(26).fill={type:'pattern',pattern:'solid',fgColor:{argb:cyan}};excelRow.getCell(27).fill={type:'pattern',pattern:'solid',fgColor:{argb:cyan}};excelRow.getCell(26).font={bold:true,color:{argb:'FF0E7490'}};}
    applyChangeHighlights(excelRow,row,{employee:2,role:4,wage:5,labels:25,notes:20});
  });
  const totalRow=sheet.addRow(['','TOTAL','','','',...Array(22).fill(null)]);const first=5,last=4+rows.length;totalRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:light}};totalRow.font={bold:true};
  [6,7,8,9,10,11,12,13,14,15,16,17,18].forEach(column=>{totalRow.getCell(column).value={formula:`SUM(${sheet.getColumn(column).letter}${first}:${sheet.getColumn(column).letter}${last})`};});
  sheet.columns=[6,30,28,24,12,16,15,18,16,20,18,18,14,12,15,14,18,15,18,60,20,12,12,13,18,26,80].map(width=>({width}));sheet.views=[{state:'frozen',ySplit:4,xSplit:2}];sheet.autoFilter={from:'A4',to:'AA4'};sheet.getColumn(5).numFmt='$0.00';for(let c=6;c<=14;c++)sheet.getColumn(c).numFmt='0.00';for(let c=15;c<=18;c++)sheet.getColumn(c).numFmt='$#,##0.00';sheet.getColumn(24).numFmt='$0.00';for(let c=21;c<=23;c++)sheet.getColumn(c).hidden=true;
}
function safeName(value:string){return value.replace(/^Chiang Mai /,'').replace(/[\\/*?:\[\]]/g,'').slice(0,31)||'Location';}
function addLocation(workbook:ExcelJS.Workbook,location:string,rows:any[],start:string,end:string){const holidayLabel=ontarioHolidayLabel(start,end);const sheet=workbook.addWorksheet(safeName(location));sheet.mergeCells('A1:U1');sheet.getCell('A1').value=`${location} — ${start} to ${end}`;sheet.getCell('A1').font={bold:true,size:14};sheet.mergeCells('A2:U2');sheet.getCell('A2').value='Hours are shown for this location only. The normal 88h cheque cap is applied separately for each worked location because payroll is run per location. Multi-location employees are labelled; this sheet only pays the hours clocked at this location. Special employee exception rules are still respected. Ontario holiday pay is capped to 8h and consumes that location cheque cap before excess hours move to cash. Wage and cash wage are shown for manager/accounting review.';sheet.getCell('A2').font={italic:true,color:{argb:'FF666666'}};sheet.addRow([]);const head=sheet.addRow(['#','Employee','Change Labels','Role(s)','Wage ($/hr)','Cash Wage ($/hr)','Actual Hours','Break Hours','Payable Total',`Regular Payable (excl ${holidayLabel})`,`Holiday Hours (${holidayLabel})`,'Rounded 0.25h','Cheque Hours','Cash Hours','Cheque Pay','Cash Pay','Holiday Premium Pay','Total Pay','Multi-location Label','Location Hour Breakdown','Notes']);header(head);rows.forEach((row,index)=>{const local=payrollLocationView(row,location);const labelNotes=[(row.employee_labels||[]).length?`Labels: ${(row.employee_labels||[]).join(', ')}`:'',row.wage_change_note,row.detail_change_note].filter(Boolean).join('; ');const baseNotes=row.locations.length>1?`Also worked: ${row.locations.filter((item:string)=>item!==location).join(', ')}${local.notes?`; ${local.notes}`:''}`:local.notes;const excelRow=sheet.addRow([index+1,row.employee_name,changeLabels(row),row.roles.join(', '),row.wage,row.cash_wage,local.gross_hours,local.break_hours,local.payable_hours,local.regular_payable_hours,local.holiday_hours,local.rounded_hours,local.cheque_hours,local.cash_hours,local.cheque_pay,local.cash_pay,local.holiday_pay,local.total_pay,multiLocationLabel(row),locationHourBreakdown(row),[labelNotes,baseNotes].filter(Boolean).join('; ')]);if(row.locations.length>1){excelRow.getCell(19).fill={type:'pattern',pattern:'solid',fgColor:{argb:cyan}};excelRow.getCell(20).fill={type:'pattern',pattern:'solid',fgColor:{argb:cyan}};excelRow.getCell(19).font={bold:true,color:{argb:'FF0E7490'}};}applyChangeHighlights(excelRow,row,{employee:2,labels:3,role:4,wage:5,notes:21});});sheet.columns=[6,30,18,24,12,14,16,14,16,20,18,16,15,14,15,14,18,15,26,80,65].map(width=>({width}));sheet.views=[{state:'frozen',ySplit:4,xSplit:2}];sheet.autoFilter={from:'A4',to:'U4'};for(let c=5;c<=6;c++)sheet.getColumn(c).numFmt='$0.00';for(let c=7;c<=14;c++)sheet.getColumn(c).numFmt='0.00';for(let c=15;c<=18;c++)sheet.getColumn(c).numFmt='$#,##0.00';}

export async function GET(request:NextRequest){try{const params=request.nextUrl.searchParams;const start=params.get('start')||'';const end=params.get('end')||'';const selectedLocation=params.get('location')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return NextResponse.json({error:'Valid dates are required'},{status:400});const report=await getPayrollReport(start,end);const rows=selectedLocation?report.rows.filter(row=>row.locations.includes(selectedLocation)):report.rows;const workbook=new ExcelJS.Workbook();workbook.creator='CM Pay';workbook.created=new Date();addMerged(workbook,rows,start,end);const locations=selectedLocation?[selectedLocation]:[...new Set(rows.flatMap(row=>row.locations))].sort();locations.forEach(location=>addLocation(workbook,location,rows.filter(row=>row.locations.includes(location)),start,end));
  const exceptions=workbook.addWorksheet('Exception Actions');exceptions.columns=[{header:'Employee',width:30},{header:'Rule / Status',width:24},{header:'Action Applied',width:45},{header:'Notes',width:70}];header(exceptions.getRow(1));rows.filter(row=>row.status||row.notes).forEach(row=>exceptions.addRow([row.employee_name,row.status,`${row.cheque_hours.toFixed(2)} cheque / ${row.cash_hours.toFixed(2)} cash`,row.notes]));
  const checks=workbook.addWorksheet('Checks');checks.columns=[{width:42},{width:18},{width:20}];checks.addRow(['PAYROLL CHECKS','Value','Status']);header(checks.getRow(1));const summary=summarizePayrollReport(rows);const locationHours=rows.reduce((sum,row)=>sum+Object.values(row.location_hours).reduce((a,b)=>a+b,0),0);const missingWages=rows.filter(row=>row.wage<=0&&row.rule_type!=='SALARY_FIXED').length;checks.addRows([['Employee count',summary.employees,'INFO'],['Payable hours total (matches 7shifts)',summary.payable_hours,'INFO'],['Regular payable hours (cheque/cash base)',summary.regular_payable_hours,'INFO'],['Ontario holiday hours',summary.holiday_hours,'INFO'],['Ontario holiday premium pay',summary.holiday_pay,'INFO'],['Regular + holiday hours reconciliation',Math.round((summary.regular_payable_hours+summary.holiday_hours-summary.payable_hours)*100)/100,Math.abs(summary.regular_payable_hours+summary.holiday_hours-summary.payable_hours)<.01?'PASS':'FAIL'],['Location hours reconciliation',Math.round((locationHours-summary.payable_hours)*100)/100,Math.abs(locationHours-summary.payable_hours)<.01?'PASS':'FAIL'],['Employees missing wage',missingWages,missingWages===0?'PASS':'FAIL'],['Gross - payable (unpaid breaks)',Math.round((summary.gross_hours-summary.payable_hours)*100)/100,'INFO'],['All recorded break hours',summary.break_hours,'INFO']]);checks.getColumn(2).numFmt='0.00';
  const hasHoliday=rows.some(row=>Number(row.holiday_hours||0)>0);const buffer=await workbook.xlsx.writeBuffer();return new NextResponse(buffer as any,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Payroll_${start}_${end}${hasHoliday?'_WITH_HOLIDAY':''}${selectedLocation?`_${safeName(selectedLocation)}`:''}.xlsx"`}});}catch(error:any){return NextResponse.json({error:error.message},{status:500});}}
