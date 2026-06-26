import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
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
const pctFmt  = '0.0"%"';
const cadFmt  = '"$"#,##0.00';

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
      const punches = await fetchAll(supabase,'punches', q=>q
        .or(empId?`employee_id.eq.${empId},employee_id.eq.7S-${empId?.replace('7S-','')}`:'employee_id.neq.null')
        .gte('clocked_in',from+'T00:00:00').lte('clocked_in',to+'T23:59:59')
        .order('clocked_in',{ascending:false}));
      const ws=wb.addWorksheet('Logbook');
      ws.columns=[{header:'Date',width:14},{header:'Clock In',width:12},{header:'Clock Out',width:12},{header:'Break (min)',width:12},{header:'Payroll Hours',width:14},{header:'Gross Hours',width:12},{header:'Location',width:22},{header:'Role',width:16},{header:'Wage',width:10},{header:'Pay',width:12}];
      hdr(ws,1); fill(ws,1);
      for(const p of punches){
        const ph=+p.payroll_hours||+p.hours||0;
        const wage=+p.wage||0;
        ws.addRow([p.clocked_in?.split('T')[0],p.clocked_in?.split('T')[1]?.slice(0,5),p.clocked_out?.split('T')[1]?.slice(0,5)||'Still In',+p.break_minutes||0,ph,+p.gross_hours||ph,p.location,p.role||p.department,wage,+(ph*wage).toFixed(2)]);
      }
    } else {
      // Full export — all tabs
      const [punches,rules,sales] = await Promise.all([
        fetchAll(supabase,'punches',q=>q.gte('clocked_in',from+'T00:00:00').lte('clocked_in',to+'T23:59:59')),
        fetchAll(supabase,'employee_rules',q=>q.eq('active',true)),
        fetchAll(supabase,'daily_sales',q=>q.gte('sale_date',from).lte('sale_date',to)),
      ]);

      // ── Sheet 1: Employee Payroll ──
      const ws1=wb.addWorksheet('Employee Payroll');
      ws1.columns=[{header:'Employee',width:28},{header:'Location',width:22},{header:'Dept',width:16},{header:'Role',width:16},{header:'Total Hrs',width:10},{header:'Payroll Hrs',width:12},{header:'Cash Hrs',width:10},{header:'Wage',width:10},{header:'Payroll $',width:12},{header:'Cash $',width:10},{header:'Total $',width:12},{header:'Rule',width:16}];
      hdr(ws1,1); fill(ws1,1);
      const empMap=new Map<string,any>();
      for(const p of punches){
        const k=p.employee_name;
        const rule=rules.find((r:any)=>r.employee_name?.toLowerCase()===k?.toLowerCase());
        if(!empMap.has(k)) empMap.set(k,{name:k,loc:p.location,dept:p.department,role:p.role,wage:+p.wage||0,hours:0,payroll_hrs:0,cash_hrs:0,payroll:0,cash:0,rule:rule?.rule_type||'STANDARD'});
        const e=empMap.get(k);
        const h=+p.payroll_hours||+p.hours||0;
        const w=+p.wage||e.wage||0;
        e.hours+=h; e.wage=w;
        if(rule?.rule_type==='CASH_ONLY'){e.cash_hrs+=h;e.cash+=h*w;}
        else{e.payroll_hrs+=h;e.payroll+=h*w;}
      }
      for(const[,e] of [...empMap.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
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
      ws3.columns=[{header:'Employee',width:26},{header:'Date',width:12},{header:'In',width:10},{header:'Out',width:10},{header:'Break (min)',width:11},{header:'Payroll Hrs',width:12},{header:'Gross Hrs',width:10},{header:'Location',width:22},{header:'Role',width:16},{header:'Wage',width:8},{header:'Pay',width:10}];
      hdr(ws3,1); fill(ws3,1);
      for(const p of punches.sort((a:any,b:any)=>a.employee_name.localeCompare(b.employee_name))){
        const ph=+p.payroll_hours||+p.hours||0;
        ws3.addRow([p.employee_name,p.clocked_in?.split('T')[0],p.clocked_in?.split('T')[1]?.slice(0,5),p.clocked_out?.split('T')[1]?.slice(0,5)||'Still In',+p.break_minutes||0,ph,+p.gross_hours||ph,p.location,p.role||p.department,+p.wage||0,+(ph*(+p.wage||0)).toFixed(2)]);
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
