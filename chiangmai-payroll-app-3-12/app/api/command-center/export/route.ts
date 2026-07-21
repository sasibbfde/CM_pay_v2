import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { payrollLocationView } from '@/lib/payroll-report';

export const maxDuration = 120;

const money = '$#,##0.00';
const num = '0.00';
const pct = '0.0%';

function validDate(value:string|null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function fetchAll(supabase:any,table:string,columns:string,filter?:(query:any)=>any) {
  const rows:any[] = [];
  for (let from=0;;from+=1000) {
    let query = supabase.from(table).select(columns).range(from,from+999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function header(row:ExcelJS.Row) {
  row.font = { bold:true, color:{ argb:'FFFFFFFF' } };
  row.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF111827' } };
  row.alignment = { vertical:'middle', wrapText:true };
}

function autoWidth(sheet:ExcelJS.Worksheet, widths:number[]) {
  sheet.columns = widths.map(width=>({ width }));
}

function toNum(value:any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sheetName(value:string) {
  return value.replace(/[\\/*?:\[\]]/g,'').slice(0,31) || 'Sheet';
}

export async function GET(req:NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const start = params.get('start');
    const end = params.get('end');
    const scheduleStart = params.get('schedule_start') || start;
    if (!validDate(start) || !validDate(end) || !validDate(scheduleStart)) {
      return NextResponse.json({ error:'Valid start, end, and schedule_start dates are required' }, { status:400 });
    }

    const supabase = getSupabaseAdmin();
    const [report, sales, employees, schedules, alerts] = await Promise.all([
      getPayrollReport(start!,end!),
      fetchAll(supabase,'daily_sales','sale_date,location,net_sales,gross_sales,projected_sales',query=>query.gte('sale_date',start!).lte('sale_date',end!).order('sale_date')),
      fetchAll(supabase,'employees','full_name,location,department,role,wage,cash_wage,active,is_new,wage_upgrade_note',query=>query.eq('active',true).order('full_name')),
      fetchAll(supabase,'scheduled_shifts','employee_id,seven_shifts_user_id,employee_name,location,department,role,start_at,end_at,scheduled_hours,status',query=>query.gte('start_at',`${scheduleStart}T00:00:00.000Z`).lte('start_at',`${end}T23:59:59.999Z`).order('start_at')),
      fetchAll(supabase,'audit_log','created_at,record_id,notes',query=>query.eq('action','payroll_alert').gte('created_at',`${start}T00:00:00.000Z`).lte('created_at',`${end}T23:59:59.999Z`).order('created_at',{ ascending:false })),
    ]);

    const salesByLocation = new Map<string,number>();
    for (const sale of sales) {
      const location = sale.location || 'Unknown';
      salesByLocation.set(location,(salesByLocation.get(location)||0)+toNum(sale.net_sales ?? sale.gross_sales));
    }
    const salesTotal = [...salesByLocation.values()].reduce((sum,value)=>sum+value,0);

    const locationMap = new Map<string,{location:string; staff:Set<string>; payable:number; cheque:number; cash:number; cost:number; sales:number; scheduled:number; alerts:number}>();
    for (const [location,value] of salesByLocation) locationMap.set(location,{location,staff:new Set(),payable:0,cheque:0,cash:0,cost:0,sales:value,scheduled:0,alerts:0});
    for (const row of report.rows) {
      for (const location of row.locations) {
        const local = payrollLocationView(row,location);
        const item = locationMap.get(location) || {location,staff:new Set(),payable:0,cheque:0,cash:0,cost:0,sales:0,scheduled:0,alerts:0};
        item.staff.add(row.employee_id || row.employee_name);
        item.payable += local.payable_hours;
        item.cheque += local.cheque_pay;
        item.cash += local.cash_pay;
        item.cost += local.total_pay;
        locationMap.set(location,item);
      }
    }
    for (const shift of schedules) {
      const location = shift.location || 'Unknown';
      const item = locationMap.get(location) || {location,staff:new Set(),payable:0,cheque:0,cash:0,cost:0,sales:0,scheduled:0,alerts:0};
      item.scheduled += toNum(shift.scheduled_hours);
      item.staff.add(shift.employee_id || shift.seven_shifts_user_id || shift.employee_name);
      locationMap.set(location,item);
    }

    const forecast = new Map<string,{employee:string; current:number; scheduled:number; projected:number; locations:Set<string>}>();
    for (const row of report.rows) {
      forecast.set(row.employee_id || row.employee_name.toLowerCase(),{employee:row.employee_name,current:row.rounded_hours,scheduled:0,projected:row.rounded_hours,locations:new Set(row.locations)});
    }
    for (const shift of schedules) {
      const key = shift.employee_id || shift.seven_shifts_user_id || String(shift.employee_name).toLowerCase();
      const row = forecast.get(key) || {employee:shift.employee_name,current:0,scheduled:0,projected:0,locations:new Set<string>()};
      row.scheduled += toNum(shift.scheduled_hours);
      row.projected = row.current + row.scheduled;
      if (shift.location) row.locations.add(shift.location);
      forecast.set(key,row);
    }
    const forecastRows = [...forecast.values()].filter(row=>row.scheduled>0 || row.current>=75).sort((a,b)=>b.projected-a.projected);

    const missingWages = employees.filter((employee:any)=>toNum(employee.wage)<=0);
    const missingDetails = employees.filter((employee:any)=>!employee.location || !employee.role);
    const overCash = report.rows.filter(row=>row.cash_hours>0);
    const near88 = report.rows.filter(row=>row.cash_hours===0 && row.rounded_hours>=75);
    const projectedOver88 = forecastRows.filter(row=>row.projected>88);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CM Pay';
    wb.created = new Date();

    const summary = wb.addWorksheet('Summary');
    summary.addRow(['Command Center Report', `${start} to ${end}`]).font = { bold:true, size:16 };
    summary.addRow(['Generated', new Date().toISOString()]);
    summary.addRow([]);
    header(summary.addRow(['Metric','Value']));
    [
      ['Workers this period', report.summary.employees],
      ['Gross hours', report.summary.gross_hours],
      ['Payable hours', report.summary.payable_hours],
      ['Cheque hours', report.summary.cheque_hours],
      ['Cash hours', report.summary.cash_hours],
      ['Cheque pay', report.summary.cheque_pay],
      ['Cash pay', report.summary.cash_pay],
      ['Holiday pay', report.summary.holiday_pay],
      ['Total pay', report.summary.total_pay],
      ['Sales', salesTotal],
      ['Labour %', salesTotal ? report.summary.total_pay / salesTotal : null],
      ['Future scheduled hours', schedules.reduce((sum:any,row:any)=>sum+toNum(row.scheduled_hours),0)],
      ['Projected over 88h employees', projectedOver88.length],
      ['Saved alerts', alerts.length],
    ].forEach(item=>summary.addRow(item));
    summary.getColumn(2).numFmt = money;
    summary.getCell('B13').numFmt = pct;
    autoWidth(summary,[30,22]);

    const readiness = wb.addWorksheet('Payroll Readiness');
    header(readiness.addRow(['Check','Count','Status','Where to review']));
    [
      ['Missing wage', missingWages.length, missingWages.length ? 'Fix required' : 'OK', 'Wages'],
      ['Missing location or role', missingDetails.length, missingDetails.length ? 'Review' : 'OK', 'Wages / Logbook'],
      ['Payroll exceptions / cash split', overCash.length, overCash.length ? 'Review' : 'OK', 'Payroll Hours'],
      ['Near 88h current', near88.length, near88.length ? 'Watch' : 'OK', 'Payroll Hours'],
      ['Projected over 88h', projectedOver88.length, projectedOver88.length ? 'Watch schedule' : 'OK', 'Command Center'],
      ['Schedule rows synced', schedules.length, schedules.length ? 'OK' : 'No future schedule rows', 'Command Center'],
      ['Saved punch alerts', alerts.length, alerts.length ? 'Review' : 'OK', 'Logbook / Notifications'],
    ].forEach(row=>readiness.addRow(row));
    autoWidth(readiness,[32,12,22,28]);

    const locations = wb.addWorksheet('Location Pressure');
    header(locations.addRow(['Location','Staff','Actual Payable Hrs','Future Scheduled Hrs','Cheque $','Cash $','Total Labour $','Sales $','Labour %','Action']));
    [...locationMap.values()].sort((a,b)=>(b.sales?b.cost/b.sales:0)-(a.sales?a.cost/a.sales:0)||b.cost-a.cost).forEach(row=>{
      const labourPct = row.sales ? row.cost / row.sales : null;
      const action = !row.sales ? 'Add sales' : labourPct! > .35 ? 'Cut / review' : labourPct! > .3 ? 'Watch' : row.scheduled > row.payable*.5 ? 'Future heavy' : 'OK';
      locations.addRow([row.location,row.staff.size,row.payable,row.scheduled,row.cheque,row.cash,row.cost,row.sales,labourPct,action]);
    });
    autoWidth(locations,[30,10,18,20,14,14,16,14,12,16]);
    for (let c=3;c<=4;c++) locations.getColumn(c).numFmt = num;
    for (let c=5;c<=8;c++) locations.getColumn(c).numFmt = money;
    locations.getColumn(9).numFmt = pct;

    const forecastSheet = wb.addWorksheet('Forecast Watchlist');
    header(forecastSheet.addRow(['Employee','Locations','Current Rounded Hrs','Future Scheduled Hrs','Projected Hrs','Risk']));
    forecastRows.forEach(row=>forecastSheet.addRow([row.employee,[...row.locations].join('; '),row.current,row.scheduled,row.projected,row.projected>88?'Over 88 projected':row.projected>=75?'Near 88':'OK']));
    autoWidth(forecastSheet,[30,42,18,20,16,20]);
    for (let c=3;c<=5;c++) forecastSheet.getColumn(c).numFmt = num;

    const alertSheet = wb.addWorksheet('Saved Alerts');
    header(alertSheet.addRow(['Created','Record','Notes']));
    alerts.forEach((row:any)=>alertSheet.addRow([row.created_at,row.record_id,row.notes]));
    autoWidth(alertSheet,[22,44,90]);

    const scheduledSheet = wb.addWorksheet(sheetName('Future Schedule'));
    header(scheduledSheet.addRow(['Employee','Location','Department','Role','Start','End','Scheduled Hours','Status']));
    schedules.forEach((row:any)=>scheduledSheet.addRow([row.employee_name,row.location,row.department,row.role,row.start_at,row.end_at,toNum(row.scheduled_hours),row.status]));
    autoWidth(scheduledSheet,[30,30,22,22,22,22,18,16]);
    scheduledSheet.getColumn(7).numFmt = num;

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      status:200,
      headers:{
        'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition':`attachment; filename="Command_Center_${start}_${end}.xlsx"`,
      },
    });
  } catch (error:any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}
