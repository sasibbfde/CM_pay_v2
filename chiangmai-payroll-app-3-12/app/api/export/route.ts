import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { applyEmployeeWages, calculatePayroll, filterPunchesByDateRange } from '@/lib/payroll';
import { resolveCashWage } from '@/lib/cash-rates';
import { Employee, EmployeeRule, Punch } from '@/lib/types';
import ExcelJS from 'exceljs';

async function fetchAll(supabase: any, table: string, filterFn?: (q: any)=>any) {
  const all: any[] = []; let from=0;
  while(true){
    let q=supabase.from(table).select('*').range(from,from+999);
    if(filterFn) q=filterFn(q);
    const {data,error}=await q;
    if(error) throw error;
    if(!data||data.length===0) break;
    all.push(...data);
    if(data.length<1000) break;
    from+=1000;
  }
  return all;
}

const hdr = (ws: any, row: number) => ws.getRow(row).font={bold:true,color:{argb:'FFe5e7eb'}};
const fill = (ws: any, row: number) => ws.getRow(row).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF131720'}};
const toNum = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const mapPunch = (row: any): Punch => ({ ...row, hours:toNum(row.hours), wage:toNum(row.wage), cash_wage:toNum(row.cash_wage) });
const mapRule = (row: any): EmployeeRule => ({ ...row, active:row.active !== false });
const safeSheetName = (value:string) => value.replace(/^Chiang Mai /,'').replace(/[\\/*?:\[\]]/g,'').slice(0,31) || 'Unknown';

export async function GET(req: NextRequest) {
  try {
    const sp   = req.nextUrl.searchParams;
    const from = sp.get('from') || new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0];
    const to   = sp.get('to')   || new Date().toISOString().split('T')[0];
    const type = sp.get('type') || 'full'; // full | payroll | logbook | labour | sales

    const supabase = getSupabaseAdmin();
    const wb = new ExcelJS.Workbook();
    wb.creator='CM Payroll';

    if (type==='logbook') {
      const empId = sp.get('employee_id');
      const empName = sp.get('name')||'Employee';
      const allPunches = await fetchAll(supabase,'punches', q=>q
        .or(empId?`employee_id.eq.${empId},employee_id.eq.7S-${empId?.replace('7S-','')}`:'employee_id.neq.null')
        .order('clocked_in',{ascending:false}));
      const punches = filterPunchesByDateRange(allPunches.map(mapPunch), from, to);
      const ws=wb.addWorksheet('Logbook');
      ws.columns=[{header:'Date',width:14},{header:'Clock In',width:12},{header:'Clock Out',width:12},{header:'Break (min)',width:12},{header:'Payroll Hours',width:14},{header:'Gross Hours',width:12},{header:'Location',width:22},{header:'Role',width:16},{header:'Cheque Wage',width:12},{header:'Cash Wage',width:12},{header:'Cheque Pay',width:12},{header:'Cash Pay',width:12}];
      hdr(ws,1); fill(ws,1);
      for(const p of punches){
        const ph=Number(p.payroll_hours)||Number(p.hours)||0;
        const wage=+p.wage||0;
        const cashWage=resolveCashWage({name:p.employee_name,location:p.location,cash_wage:p.cash_wage});
        ws.addRow([p.clocked_in?.split('T')[0],p.clocked_in?.split('T')[1]?.slice(0,5),p.clocked_out?.split('T')[1]?.slice(0,5)||'Still In',Number(p.break_minutes)||0,ph,Number(p.gross_hours)||ph,p.location,p.role||p.department,wage,cashWage,+(ph*wage).toFixed(2),+(ph*cashWage).toFixed(2)]);
      }
    } else {
      // Full export — all tabs
      const [allPunches,rules,employees,sales] = await Promise.all([
        fetchAll(supabase,'punches'),
        fetchAll(supabase,'employee_rules',q=>q.eq('active',true)),
        fetchAll(supabase,'employees'),
        fetchAll(supabase,'daily_sales',q=>q.gte('sale_date',from).lte('sale_date',to)),
      ]);
      const punches = applyEmployeeWages(
        filterPunchesByDateRange(allPunches.map(mapPunch), from, to),
        employees as Employee[],
      );
      const payrollRows = calculatePayroll(punches, rules.map(mapRule));

      // ── Sheet 1: Employee Payroll ──
      const ws1=wb.addWorksheet('Employee Payroll');
      ws1.columns=[{header:'Employee',width:28},{header:'Location',width:22},{header:'Dept',width:16},{header:'Role',width:16},{header:'Total Hrs',width:10},{header:'Payroll Hrs',width:12},{header:'Cash Hrs',width:10},{header:'Wage',width:10},{header:'Payroll $',width:12},{header:'Cash $',width:10},{header:'Total $',width:12},{header:'Rule',width:16}];
      hdr(ws1,1); fill(ws1,1);
      const empMap=new Map<string,any>();
      for(const row of payrollRows){
        empMap.set(row.employee_id || row.employee_name,{name:row.employee_name,loc:row.location,dept:row.department,role:row.role,wage:row.wage,hours:row.actual_hours,payroll_hrs:row.payroll_hours,cash_hrs:row.cash_hours,payroll:row.payroll_amount,cash:row.cash_amount,rule:row.rule_applied});
      }
      for(const[,e] of [...empMap.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
        ws1.addRow([e.name,e.loc||'',e.dept||'',e.role||'',+e.hours.toFixed(2),+e.payroll_hrs.toFixed(2),+e.cash_hrs.toFixed(2),+e.wage.toFixed(2),+e.payroll.toFixed(2),+e.cash.toFixed(2),+(e.payroll+e.cash).toFixed(2),e.rule]);
      }
      const totRow=ws1.addRow(['TOTAL','','','',
        [...empMap.values()].reduce((s,e)=>s+e.hours,0).toFixed(2),'','','',
        [...empMap.values()].reduce((s,e)=>s+e.payroll,0).toFixed(2),
        [...empMap.values()].reduce((s,e)=>s+e.cash,0).toFixed(2),
        [...empMap.values()].reduce((s,e)=>s+e.payroll+e.cash,0).toFixed(2),'']);
      totRow.font={bold:true};

      // ── Sheet 2: Location Summary ──
      const ws2=wb.addWorksheet('Location Summary');
      ws2.columns=[{header:'Location',width:24},{header:'Staff',width:8},{header:'Hours',width:10},{header:'Payroll $',width:12},{header:'Cash $',width:10},{header:'Total Labour $',width:14},{header:'Cost/Hr',width:10},{header:'Sales $',width:12},{header:'Labour %',width:10}];
      hdr(ws2,1); fill(ws2,1);
      const locMap=new Map<string,any>();
      for(const[,e] of empMap){
        const l=e.loc||'Unknown';
        if(!locMap.has(l)) locMap.set(l,{loc:l,staff:0,hours:0,payroll:0,cash:0});
        const lv=locMap.get(l); lv.staff++; lv.hours+=e.hours; lv.payroll+=e.payroll; lv.cash+=e.cash;
      }
      const salesByLoc=new Map<string,number>();
      for(const s of sales) salesByLoc.set(s.location,(salesByLoc.get(s.location)||0)+(+s.net_sales||0));
      for(const[loc,lv] of [...locMap.entries()].sort((a,b)=>b[1].payroll+b[1].cash-a[1].payroll-a[1].cash)){
        const sale=salesByLoc.get(loc)||0;
        const total=lv.payroll+lv.cash;
        ws2.addRow([loc,lv.staff,+lv.hours.toFixed(1),+lv.payroll.toFixed(2),+lv.cash.toFixed(2),+total.toFixed(2),lv.hours>0?+(total/lv.hours).toFixed(2):0,sale||'',sale>0?+((total/sale)*100).toFixed(1)+'%':'—']);
      }

      // ── Sheet 3: Daily Punches ──
      const ws3=wb.addWorksheet('Daily Punches');
      ws3.columns=[{header:'Employee',width:26},{header:'Date',width:12},{header:'In',width:10},{header:'Out',width:10},{header:'Break (min)',width:11},{header:'Payroll Hrs',width:12},{header:'Gross Hrs',width:10},{header:'Location',width:22},{header:'Role',width:16},{header:'Cheque Wage',width:12},{header:'Cash Wage',width:12},{header:'Cheque Pay',width:12},{header:'Cash Pay',width:12}];
      hdr(ws3,1); fill(ws3,1);
      for(const p of punches.sort((a:any,b:any)=>a.employee_name.localeCompare(b.employee_name))){
        const ph=Number(p.payroll_hours)||Number(p.hours)||0;
        const wage=+p.wage||0;
        const cashWage=resolveCashWage({name:p.employee_name,location:p.location,cash_wage:p.cash_wage});
        ws3.addRow([p.employee_name,p.clocked_in?.split('T')[0],p.clocked_in?.split('T')[1]?.slice(0,5),p.clocked_out?.split('T')[1]?.slice(0,5)||'Still In',Number(p.break_minutes)||0,ph,Number(p.gross_hours)||ph,p.location,p.role||p.department,wage,cashWage,+(ph*wage).toFixed(2),+(ph*cashWage).toFixed(2)]);
      }

      // One authoritative labour sheet per actual punch location. Multi-location
      // employees therefore appear separately in every location they worked.
      const punchesByLocation=new Map<string,Punch[]>();
      for(const punch of punches){const location=punch.location||'Unknown';punchesByLocation.set(location,[...(punchesByLocation.get(location)||[]),punch]);}
      for(const [location,locationPunches] of [...punchesByLocation.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
        const sheet=wb.addWorksheet(safeSheetName(location));
        sheet.columns=[{header:'Employee',width:28},{header:'Role',width:18},{header:'Actual Hours',width:14},{header:'Break Hours',width:13},{header:'Payroll Hours',width:14},{header:'Wage',width:10},{header:'Labour Cost',width:14}];hdr(sheet,1);fill(sheet,1);
        const employeesAtLocation=new Map<string,any>();
        for(const punch of locationPunches){if(!punch.clocked_out)continue;const key=punch.employee_id||punch.employee_name;const payroll=Number(punch.payroll_hours)||Number(punch.hours)||0;const gross=Number(punch.gross_hours)||payroll;const wage=Number(punch.wage)||0;const row=employeesAtLocation.get(key)||{name:punch.employee_name,role:punch.role||punch.department||'',actual:0,breaks:0,payroll:0,cost:0};row.actual+=gross;row.breaks+=Number(punch.break_minutes||0)/60;row.payroll+=payroll;row.cost+=payroll*wage;employeesAtLocation.set(key,row);}
        for(const row of [...employeesAtLocation.values()].sort((a,b)=>a.name.localeCompare(b.name)))sheet.addRow([row.name,row.role,+row.actual.toFixed(2),+row.breaks.toFixed(2),+row.payroll.toFixed(2),row.payroll?+(row.cost/row.payroll).toFixed(2):0,+row.cost.toFixed(2)]);
        const total=[...employeesAtLocation.values()].reduce((sum,row)=>({actual:sum.actual+row.actual,breaks:sum.breaks+row.breaks,payroll:sum.payroll+row.payroll,cost:sum.cost+row.cost}),{actual:0,breaks:0,payroll:0,cost:0});const totalRow=sheet.addRow(['TOTAL','',+total.actual.toFixed(2),+total.breaks.toFixed(2),+total.payroll.toFixed(2),'',+total.cost.toFixed(2)]);totalRow.font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'G1'};
      }

      // ── Sheet 4: Sales Data ──
      if(sales.length>0){
        const ws4=wb.addWorksheet('Sales & Labour %');
        ws4.columns=[{header:'Date',width:12},{header:'Location',width:22},{header:'Net Sales',width:14},{header:'Proj. Sales',width:14},{header:'Actual Labour',width:14},{header:'Labour %',width:10},{header:'SPLH',width:10},{header:'Source',width:12}];
        hdr(ws4,1); fill(ws4,1);
        for(const s of sales.sort((a:any,b:any)=>a.sale_date.localeCompare(b.sale_date)))
          ws4.addRow([s.sale_date,s.location,+s.net_sales||0,+s.projected_sales||0,+s.actual_labor_cost||0,s.labor_percent!=null?+((+s.labor_percent)*100).toFixed(1)+'%':'—',s.sales_per_labor_hr?+(+s.sales_per_labor_hr).toFixed(2):'',(s.source||'manual')]);
      }
    }

    const buffer=await wb.xlsx.writeBuffer();
    const fname = type==='logbook' ? `logbook_${sp.get('name')||'employee'}_${from}_${to}.xlsx` : `CM_Payroll_${from}_to_${to}.xlsx`;
    return new NextResponse(buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${fname}"`}});
  } catch(e:any){
    return NextResponse.json({error:e.message},{status:500});
  }
}
