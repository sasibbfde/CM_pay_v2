'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { cachedJson, peekJson } from '@/lib/client-cache';
import { payrollLocationView, type PayrollReportRow } from '@/lib/payroll-report';

type ReportSummary = {
  employees:number; gross_hours:number; break_hours:number; payable_hours:number;
  regular_payable_hours:number; holiday_hours:number; holiday_pay:number;
  rounded_hours:number; cheque_hours:number; cash_hours:number;
  cheque_pay:number; cash_pay:number; total_pay:number;
};
type ReportApi = { rows:PayrollReportRow[]; summary:ReportSummary; start:string; end:string };
type SaleRow = { sale_date:string; location:string; net_sales:number|null; gross_sales:number|null; projected_sales:number|null };
type AlertRow = { id:string; type:string; employee_name:string; location:string; alert_date:string; severity:'warning'|'critical'; message:string };
type EmployeeRow = { full_name:string; location:string|null; role:string|null; wage:number|null; cash_wage:number|null; active:boolean; is_new?:boolean; wage_upgrade_note?:string|null };
type ScheduledShift = {
  shift_id:string; employee_id:string|null; seven_shifts_user_id:string|null; employee_name:string;
  location:string; department:string|null; role:string|null; start_at:string; end_at:string;
  scheduled_hours:number|string; status:string|null;
};

const card:React.CSSProperties = { background:'#131720', border:'1px solid rgba(255,255,255,.08)', borderRadius:14, padding:16 };
const muted:React.CSSProperties = { color:'#6b7280', fontSize:12, lineHeight:1.45 };
const sel:React.CSSProperties = { background:'#1a1f2e', border:'1px solid rgba(255,255,255,.1)', borderRadius:8, color:'#e5e7eb', padding:'8px 11px', fontSize:13, outline:'none' };
const btn:React.CSSProperties = { background:'rgba(34,211,238,.12)', border:'1px solid rgba(34,211,238,.28)', color:'#22d3ee', borderRadius:8, padding:'8px 12px', fontSize:12, fontWeight:700, textDecoration:'none', cursor:'pointer' };
const btnGreen:React.CSSProperties = { ...btn, background:'rgba(52,211,153,.1)', border:'1px solid rgba(52,211,153,.28)', color:'#34d399' };
const btnGhost:React.CSSProperties = { ...btn, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)', color:'#9ca3af' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const pad2 = (value:number) => String(value).padStart(2,'0');
const isoDate = (date:Date) => `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
const addDays = (date:Date, days:number) => { const next = new Date(date); next.setDate(next.getDate()+days); return next; };
const cad = (value:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(value||0);
const cadFull = (value:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(value||0);
const hrs = (value:number) => `${(value||0).toFixed(2)}h`;
const pct = (value:number) => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : '—';
const toNum = (value:unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
type RangeMode = 'today'|'yesterday'|'last7'|'pay-period'|'this-month'|'last-month';

function periodRange(year:number,month:number,period:string){
  const prefix = `${year}-${pad2(month)}`;
  const last = pad2(new Date(year,month,0).getDate());
  if (period === '1-15') return { start:`${prefix}-01`, end:`${prefix}-15`, label:`${MONTHS[month-1]} 1–15, ${year}` };
  if (period === '16-end') return { start:`${prefix}-16`, end:`${prefix}-${last}`, label:`${MONTHS[month-1]} 16–${Number(last)}, ${year}` };
  return { start:`${prefix}-01`, end:`${prefix}-${last}`, label:`${MONTHS[month-1]} full month, ${year}` };
}

function selectedRange(mode:RangeMode, year:number, month:number, period:string, now:Date) {
  const today = isoDate(now);
  if (mode === 'today') return { start:today, end:today, label:'Today' };
  const yesterday = isoDate(addDays(now,-1));
  if (mode === 'yesterday') return { start:yesterday, end:yesterday, label:'Yesterday' };
  if (mode === 'last7') return { start:isoDate(addDays(now,-6)), end:today, label:'Last 7 days' };
  if (mode === 'this-month') return periodRange(now.getFullYear(),now.getMonth()+1,'month');
  if (mode === 'last-month') {
    const previous = new Date(now.getFullYear(),now.getMonth()-1,1);
    return periodRange(previous.getFullYear(),previous.getMonth()+1,'month');
  }
  return periodRange(year,month,period);
}

function scoreColor(status:'green'|'yellow'|'red') {
  if (status === 'green') return '#34d399';
  if (status === 'yellow') return '#fbbf24';
  return '#f87171';
}

function statusFor(value:boolean, warn=false):'green'|'yellow'|'red' {
  if (value) return warn ? 'yellow' : 'red';
  return 'green';
}

export default function CommandCenterPage() {
  const now = useMemo(()=>new Date(),[]);
  const [year,setYear] = useState(now.getFullYear());
  const [month,setMonth] = useState(now.getMonth()+1);
  const [period,setPeriod] = useState(now.getDate() <= 15 ? '1-15' : '16-end');
  const [rangeMode,setRangeMode] = useState<RangeMode>('pay-period');
  const [forceToken,setForceToken] = useState(0);
  const range = useMemo(()=>selectedRange(rangeMode,year,month,period,now),[rangeMode,year,month,period,now]);
  const today = isoDate(now);
  const hasFutureScheduleWindow = range.end >= today;
  const futureStart = hasFutureScheduleWindow && today > range.start && today <= range.end ? today : range.start;
  const reportUrl = `/api/payroll-report?start=${range.start}&end=${range.end}`;
  const salesUrl = `/api/sales?from=${range.start}&to=${range.end}`;
  const alertsUrl = `/api/alerts?from=${range.start}&to=${range.end}`;
  const employeesUrl = '/api/employees?active=true';
  const scheduleUrl = `/api/schedule?start=${futureStart}&end=${range.end}`;

  const [report,setReport] = useState<ReportApi|undefined>(()=>peekJson<ReportApi>(reportUrl));
  const [sales,setSales] = useState<SaleRow[]>(()=>peekJson<{sales:SaleRow[]}>(salesUrl)?.sales || []);
  const [alerts,setAlerts] = useState<AlertRow[]>(()=>peekJson<{alerts:AlertRow[]}>(alertsUrl)?.alerts || []);
  const [employees,setEmployees] = useState<EmployeeRow[]>(()=>peekJson<{employees:EmployeeRow[]}>(employeesUrl)?.employees || []);
  const [schedule,setSchedule] = useState<ScheduledShift[]>(()=>peekJson<{shifts:ScheduledShift[]}>(scheduleUrl)?.shifts || []);
  const [scheduleSyncing,setScheduleSyncing] = useState(false);
  const [scheduleMsg,setScheduleMsg] = useState('');
  const [loading,setLoading] = useState(!report);
  const [error,setError] = useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(!peekJson<ReportApi>(reportUrl));
    setError('');
    Promise.all([
      cachedJson<ReportApi>(reportUrl,120_000,forceToken>0),
      cachedJson<{sales:SaleRow[]}>(salesUrl,120_000,forceToken>0),
      cachedJson<{alerts:AlertRow[]}>(alertsUrl,60_000,forceToken>0),
      cachedJson<{employees:EmployeeRow[]}>(employeesUrl,120_000,forceToken>0),
      cachedJson<{shifts:ScheduledShift[]}>(scheduleUrl,120_000,forceToken>0),
    ]).then(([periodReport,salesData,alertData,employeeData,scheduleData])=>{
      if (cancelled) return;
      setReport(periodReport);
      setSales(salesData.sales || []);
      setAlerts(alertData.alerts || []); setEmployees(employeeData.employees || []);
      setSchedule(scheduleData.shifts || []);
    }).catch((err:any)=>{ if(!cancelled) setError(err.message || 'Command Center failed to load'); })
      .finally(()=>{ if(!cancelled) setLoading(false); });
    return ()=>{cancelled=true;};
  },[reportUrl,salesUrl,alertsUrl,employeesUrl,scheduleUrl,forceToken]);

  async function syncSchedule() {
    setScheduleSyncing(true);
    setScheduleMsg('');
    try {
      const response = await fetch('/api/schedule', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({ start:futureStart, end:range.end }),
      });
      const json = await response.json();
      if (!response.ok || json.ok === false) throw new Error(json.error || 'Schedule sync failed');
      setScheduleMsg(`Synced ${json.synced || 0} scheduled shifts for forecast.`);
      setForceToken(value=>value+1);
    } catch (err:any) {
      setScheduleMsg(err.message || 'Schedule sync failed');
    } finally {
      setScheduleSyncing(false);
    }
  }

  const periodSales = useMemo(()=>sales.reduce((sum,row)=>sum+Number(row.net_sales ?? row.gross_sales ?? 0),0),[sales]);
  const summary = report?.summary || {employees:0,gross_hours:0,break_hours:0,payable_hours:0,regular_payable_hours:0,holiday_hours:0,holiday_pay:0,rounded_hours:0,cheque_hours:0,cash_hours:0,cheque_pay:0,cash_pay:0,total_pay:0};
  const labourPct = periodSales ? summary.total_pay / periodSales : 0;

  const locationRows = useMemo(()=>{
    const map = new Map<string,{location:string; staff:Set<string>; payable:number; cheque:number; cash:number; cost:number; sales:number; alerts:number}>();
    for (const sale of sales) {
      const key = sale.location || 'Unknown';
      const row = map.get(key) || {location:key,staff:new Set<string>(),payable:0,cheque:0,cash:0,cost:0,sales:0,alerts:0};
      row.sales += Number(sale.net_sales ?? sale.gross_sales ?? 0);
      map.set(key,row);
    }
    for (const reportRow of report?.rows || []) {
      for (const location of reportRow.locations) {
        const local = payrollLocationView(reportRow,location);
        const row = map.get(location) || {location,staff:new Set<string>(),payable:0,cheque:0,cash:0,cost:0,sales:0,alerts:0};
        row.staff.add(reportRow.employee_id || reportRow.employee_name);
        row.payable += local.payable_hours;
        row.cheque += local.cheque_pay;
        row.cash += local.cash_pay;
        row.cost += local.total_pay;
        map.set(location,row);
      }
    }
    for (const alert of alerts) {
      const locations = (alert.location || 'Unknown').split(';').map(item=>item.trim()).filter(Boolean);
      for (const location of locations.length ? locations : ['Unknown']) {
        const row = map.get(location) || {location,staff:new Set<string>(),payable:0,cheque:0,cash:0,cost:0,sales:0,alerts:0};
        row.alerts += 1;
        map.set(location,row);
      }
    }
    return [...map.values()].map(row=>({...row,staffCount:row.staff.size,labourPct:row.sales ? row.cost / row.sales : 0}))
      .sort((a,b)=>(b.labourPct-a.labourPct)||(b.cost-a.cost));
  },[report?.rows,sales,alerts]);

  const scheduleSummary = useMemo(()=>{
    const byLocation = new Map<string,{location:string; hours:number; shifts:number; staff:Set<string>}>();
    let hoursTotal = 0;
    for (const shift of schedule) {
      const hoursValue = toNum(shift.scheduled_hours);
      if (hoursValue <= 0) continue;
      hoursTotal += hoursValue;
      const location = shift.location || 'Unknown';
      const row = byLocation.get(location) || { location, hours:0, shifts:0, staff:new Set<string>() };
      row.hours += hoursValue;
      row.shifts += 1;
      row.staff.add(shift.employee_id || shift.seven_shifts_user_id || shift.employee_name);
      byLocation.set(location,row);
    }
    return {
      hoursTotal,
      shifts: schedule.length,
      byLocation: [...byLocation.values()].map(row=>({...row,staffCount:row.staff.size})).sort((a,b)=>b.hours-a.hours),
    };
  },[schedule]);

  const forecastByEmployee = useMemo(()=>{
    const byEmployee = new Map<string,{employee:string; current:number; scheduled:number; projected:number; locations:Set<string>}>();
    for (const row of report?.rows || []) {
      const key = row.employee_id || row.employee_name.toLowerCase();
      byEmployee.set(key,{ employee:row.employee_name, current:toNum(row.rounded_hours), scheduled:0, projected:toNum(row.rounded_hours), locations:new Set(row.locations) });
    }
    for (const shift of schedule) {
      const key = shift.employee_id || shift.seven_shifts_user_id || shift.employee_name.toLowerCase();
      const row = byEmployee.get(key) || { employee:shift.employee_name, current:0, scheduled:0, projected:0, locations:new Set<string>() };
      row.scheduled += toNum(shift.scheduled_hours);
      row.projected = row.current + row.scheduled;
      if (shift.location) row.locations.add(shift.location);
      byEmployee.set(key,row);
    }
    return [...byEmployee.values()].map(row=>({...row,locations:[...row.locations]}))
      .filter(row=>row.scheduled>0 || row.current>=75)
      .sort((a,b)=>b.projected-a.projected);
  },[report?.rows,schedule]);

  const locationPressureRows = useMemo(()=>{
    const map = new Map<string, any>(locationRows.map(row=>[row.location,{...row,scheduled:0}]));
    for (const item of scheduleSummary.byLocation) {
      const row = map.get(item.location) || { location:item.location, staffCount:0, payable:0, cheque:0, cash:0, cost:0, sales:0, alerts:0, labourPct:0 };
      row.scheduled = item.hours;
      row.staffCount = Math.max(row.staffCount || 0, item.staffCount || 0);
      map.set(item.location,row);
    }
    return [...map.values()].sort((a,b)=>(b.labourPct-a.labourPct)||(b.cost-a.cost)||(b.scheduled-a.scheduled));
  },[locationRows,scheduleSummary.byLocation]);

  const forecastRisks = useMemo(()=>({
    projectedOver88: forecastByEmployee.filter(row=>row.projected>88),
    projectedNear88: forecastByEmployee.filter(row=>row.projected<=88 && row.projected>=75),
  }),[forecastByEmployee]);

  const risks = useMemo(()=>{
    const rows = report?.rows || [];
    return {
      missingWages:employees.filter(employee=>Number(employee.wage || 0)<=0),
      missingDetails:employees.filter(employee=>!employee.location || !employee.role),
      newEmployees:employees.filter(employee=>employee.is_new),
      wageChanges:employees.filter(employee=>employee.wage_upgrade_note),
      overCash:rows.filter(row=>row.cash_hours>0),
      nearCap:rows.filter(row=>row.cash_hours===0 && row.rounded_hours>=75).sort((a,b)=>b.rounded_hours-a.rounded_hours),
      holiday:rows.filter(row=>row.holiday_hours>0),
      criticalAlerts:alerts.filter(alert=>alert.severity==='critical'),
      warningAlerts:alerts.filter(alert=>alert.severity!=='critical'),
    };
  },[report?.rows,employees,alerts]);

  const readiness = [
    {label:'Missing wage', count:risks.missingWages.length, status:statusFor(risks.missingWages.length>0), href:'/wages'},
    {label:'Missing location / role', count:risks.missingDetails.length, status:statusFor(risks.missingDetails.length>0,true), href:'/wages'},
    {label:'Payroll exceptions / cash split', count:risks.overCash.length, status:statusFor(risks.overCash.length>0,true), href:'/payroll-hours'},
    {label:'Critical punch alerts', count:risks.criticalAlerts.length, status:statusFor(risks.criticalAlerts.length>0), href:'/employees'},
    {label:'Near 88h watchlist', count:risks.nearCap.length, status:statusFor(risks.nearCap.length>0,true), href:'/payroll-hours'},
    {label:'Forecast over 88h', count:forecastRisks.projectedOver88.length, status:statusFor(forecastRisks.projectedOver88.length>0,true), href:'/command-center'},
    {label:'Holiday pay rows', count:risks.holiday.length, status:'green' as const, href:'/payroll-hours'},
  ];

  const payrollExport = `/api/payroll-report/export?start=${range.start}&end=${range.end}`;
  const ownerExport = `/api/command-center/export?start=${range.start}&end=${range.end}&schedule_start=${futureStart}`;
  const insightsExport = `/api/insights/export?from=${range.start}&to=${range.end}`;

  return (
    <main style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter, sans-serif',padding:'26px 32px'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap',marginBottom:22}}>
        <div>
          <div style={{color:'#22d3ee',fontSize:12,fontWeight:800,letterSpacing:'.14em',textTransform:'uppercase'}}>Owner / Manager Command Center</div>
          <h1 style={{fontSize:30,margin:'6px 0 4px',color:'#f9fafb'}}>What needs attention?</h1>
          <p style={{...muted,margin:0}}>One-page overview using existing synced 7shifts punches, wages, sales, payroll rules, and saved alerts.</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {[
            ['today','Today'],
            ['yesterday','Yesterday'],
            ['last7','Last 7 days'],
            ['pay-period','Payroll period'],
            ['this-month','This month'],
            ['last-month','Last month'],
          ].map(([mode,label])=><button key={mode} onClick={()=>setRangeMode(mode as RangeMode)} style={rangeMode===mode?btn:btnGhost}>{label}</button>)}
          {rangeMode==='pay-period'&&<>
            <select value={year} onChange={event=>setYear(Number(event.target.value))} style={sel}>{[2025,2026,2027].map(item=><option key={item} value={item}>{item}</option>)}</select>
            <select value={month} onChange={event=>setMonth(Number(event.target.value))} style={sel}>{MONTHS.map((item,index)=><option key={item} value={index+1}>{item}</option>)}</select>
            <select value={period} onChange={event=>setPeriod(event.target.value)} style={sel}><option value="1-15">1–15</option><option value="16-end">16–End</option><option value="month">Full month</option></select>
          </>}
          <button onClick={()=>setForceToken(value=>value+1)} style={btnGhost}>{loading?'Refreshing…':'Refresh'}</button>
        </div>
      </div>

      <div style={{...card,display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:16,padding:'12px 14px'}}>
        <div><strong style={{color:'#f9fafb'}}>Showing:</strong> <span style={{color:'#22d3ee',fontWeight:800}}>{range.label}</span> <span style={{color:'#6b7280'}}>({range.start} → {range.end})</span></div>
        <div style={{...muted}}>All cards, location pressure, alerts, forecast, and exports use this selected range.</div>
      </div>

      {error&&<div role="alert" style={{...card,border:'1px solid rgba(248,113,113,.35)',color:'#f87171',marginBottom:16}}>{error}</div>}

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:16}}>
        {[
          ['Selected Sales', periodSales ? cad(periodSales) : 'No sales yet', '#34d399'],
          ['Selected Labour', report ? cad(summary.total_pay) : '—', '#a78bfa'],
          ['Selected Labour %', labourPct ? pct(labourPct) : '—', labourPct>.35?'#f87171':labourPct>.3?'#fbbf24':'#34d399'],
          ['Selected Cheque Hrs', hrs(summary.cheque_hours), '#a78bfa'],
          ['Selected Cash Hrs', hrs(summary.cash_hours), '#fbbf24'],
          ['Future Scheduled Hrs', hrs(scheduleSummary.hoursTotal), '#22d3ee'],
          ['Projected Over 88h', String(forecastRisks.projectedOver88.length), forecastRisks.projectedOver88.length?'#f87171':'#34d399'],
          ['Selected Total Pay', cad(summary.total_pay), '#34d399'],
        ].map(([label,value,color])=><div key={label} style={card}><div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'.08em'}}>{label}</div><div style={{fontSize:24,fontWeight:800,color:String(color),marginTop:7}}>{value}</div></div>)}
      </section>

      <section style={{display:'grid',gridTemplateColumns:'minmax(320px,1.15fr) minmax(320px,.85fr)',gap:14,marginBottom:16}}>
        <div style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:10}}>
            <div><h2 style={{fontSize:17,margin:'0 0 3px',color:'#f9fafb'}}>Payroll readiness — {range.label}</h2><p style={{...muted,margin:0}}>Green means ready. Yellow means review before payroll. Red means fix first.</p></div>
            <div style={{fontSize:12,color:'#9ca3af'}}>{loading?'Loading…':`${report?.rows.length || 0} payroll rows`}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
            {readiness.map(item=>(
              <Link key={item.label} href={item.href} style={{textDecoration:'none',background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,padding:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#e5e7eb'}}>{item.label}</div>
                  <div style={{color:scoreColor(item.status),fontSize:18,fontWeight:900}}>{item.count}</div>
                </div>
                <div style={{fontSize:11,color:scoreColor(item.status),marginTop:5}}>{item.status==='green'?'OK':item.status==='yellow'?'Review':'Fix required'} → open detail</div>
              </Link>
            ))}
          </div>
        </div>

        <div style={card}>
          <h2 style={{fontSize:17,margin:'0 0 8px',color:'#f9fafb'}}>Owner report actions</h2>
          <p style={{...muted,margin:'0 0 12px'}}>Exports use the same source data as existing payroll, labour, sales, and logbook tabs.</p>
          <div style={{display:'grid',gap:9}}>
            <a href={payrollExport} style={btnGreen}>Download payroll-ready Excel</a>
            <a href={ownerExport} style={btn}>Download full owner workbook</a>
            <a href={insightsExport} style={btnGhost}>Download insights workbook</a>
            <Link href="/sop" style={btnGhost}>Open SOP / operating guide</Link>
          </div>
        </div>
      </section>

      <section style={{display:'grid',gridTemplateColumns:'minmax(360px,1fr) minmax(320px,.8fr)',gap:14,marginBottom:16}}>
        <div style={card}>
          <h2 style={{fontSize:17,margin:'0 0 4px',color:'#f9fafb'}}>Location budget pressure</h2>
          <p style={{...muted,margin:'0 0 12px'}}>Compares actual labour cost to sales, then adds future scheduled hours so managers can rebalance before payroll closes.</p>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{color:'#6b7280',textTransform:'uppercase',letterSpacing:'.07em'}}><th style={th}>Location</th><th style={th}>Staff</th><th style={th}>Payable</th><th style={th}>Scheduled</th><th style={th}>Labour</th><th style={th}>Sales</th><th style={th}>Labour %</th><th style={th}>Action</th><th style={th}>Alerts</th></tr></thead>
              <tbody>{locationPressureRows.slice(0,12).map(row=>{
                const color = row.sales ? (row.labourPct>.35?'#f87171':row.labourPct>.3?'#fbbf24':'#34d399') : '#6b7280';
                const scheduled = toNum(row.scheduled);
                const action = !row.sales ? 'Add sales' : row.labourPct > .35 ? 'Cut / review' : row.labourPct > .3 ? 'Watch' : scheduled > row.payable*.5 ? 'Future heavy' : 'OK';
                const actionColor = action === 'OK' ? '#34d399' : action === 'Watch' || action === 'Future heavy' ? '#fbbf24' : '#f87171';
                return <tr key={row.location} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={td}><Link href={`/location`} style={{color:'#e5e7eb',textDecoration:'none',fontWeight:700}}>{row.location}</Link></td><td style={td}>{row.staffCount}</td><td style={{...td,color:'#22d3ee'}}>{hrs(row.payable)}</td><td style={{...td,color:'#38bdf8'}}>{scheduled?hrs(scheduled):'—'}</td><td style={{...td,color:'#a78bfa'}}>{cad(row.cost)}</td><td style={{...td,color:'#34d399'}}>{row.sales?cad(row.sales):'—'}</td><td style={{...td,color,fontWeight:800}}>{row.sales?pct(row.labourPct):'No sales'}</td><td style={{...td,color:actionColor,fontWeight:800}}>{action}</td><td style={{...td,color:row.alerts?'#fbbf24':'#6b7280'}}>{row.alerts || '—'}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>

        <div style={card}>
          <h2 style={{fontSize:17,margin:'0 0 4px',color:'#f9fafb'}}>People to watch</h2>
          <p style={{...muted,margin:'0 0 12px'}}>Current pay-period risks from actual synced punches, plus projected risks when future scheduled hours are synced.</p>
          <WatchList title="Near 88h" color="#fbbf24" rows={risks.nearCap.slice(0,7).map(row=>`${row.employee_name} · ${hrs(row.rounded_hours)}`)} empty="No one near 88h from current punches." />
          <WatchList title="Projected over 88h" color="#f87171" rows={forecastRisks.projectedOver88.slice(0,7).map(row=>`${row.employee} · ${hrs(row.current)} actual + ${hrs(row.scheduled)} scheduled = ${hrs(row.projected)}`)} empty="No projected over-88 risk from synced schedules." />
          <WatchList title="Cash / exception rows" color="#f97316" rows={risks.overCash.slice(0,7).map(row=>`${row.employee_name} · ${hrs(row.cash_hours)} cash`)} empty="No cash split rows." />
          <WatchList title="Missing wages" color="#f87171" rows={risks.missingWages.slice(0,7).map(row=>row.full_name)} empty="No missing wages." />
        </div>
      </section>

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:14}}>
        <div style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:8}}>
            <div>
              <h2 style={{fontSize:16,margin:'0 0 4px',color:'#f9fafb'}}>Schedule forecast</h2>
              <p style={{...muted,margin:0}}>Planning only: combines actual payroll hours with scheduled future hours. It does not change payroll punches.</p>
            </div>
            <button onClick={syncSchedule} disabled={scheduleSyncing} style={{...btn,cursor:scheduleSyncing?'wait':'pointer',opacity:scheduleSyncing?0.7:1}}>{scheduleSyncing?'Syncing…':'Sync 7shifts schedule'}</button>
          </div>
          <div style={{fontSize:11,color:'#9ca3af',marginBottom:10}}>Forecast window: {futureStart} → {range.end} · {scheduleSummary.shifts} shifts · {hrs(scheduleSummary.hoursTotal)}</div>
          {scheduleMsg && <div style={{fontSize:11,color:scheduleMsg.toLowerCase().includes('failed')?'#f87171':'#34d399',marginBottom:10}}>{scheduleMsg}</div>}
          <WatchList title="Projected over 88h" color="#f87171" rows={forecastRisks.projectedOver88.slice(0,5).map(row=>`${row.employee} · ${hrs(row.projected)} projected`)} empty="No projected over-88 employees." />
          <WatchList title="Projected near 88h" color="#fbbf24" rows={forecastRisks.projectedNear88.slice(0,5).map(row=>`${row.employee} · ${hrs(row.projected)} projected`)} empty="No projected near-88 employees." />
          <WatchList title="Future hours by location" color="#22d3ee" rows={scheduleSummary.byLocation.slice(0,5).map(row=>`${row.location} · ${hrs(row.hours)} · ${row.staffCount} staff`)} empty="No future schedule synced for this window." />
        </div>
        <div style={card}>
          <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Alerts</h2>
          <p style={{...muted,margin:'0 0 10px'}}>Saved punch alerts for this period.</p>
          {alerts.length===0 ? <div style={{fontSize:12,color:'#34d399'}}>No saved alerts for this range.</div> : alerts.slice(0,5).map(alert=><Link key={alert.id} href={`/employees?alert=${encodeURIComponent(alert.employee_name)}`} style={{display:'block',textDecoration:'none',padding:'8px 0',borderTop:'1px solid rgba(255,255,255,.06)'}}><div style={{fontSize:12,color:alert.severity==='critical'?'#f87171':'#fbbf24',fontWeight:800}}>{alert.employee_name} · {alert.alert_date}</div><div style={{fontSize:11,color:'#9ca3af'}}>{alert.message}</div></Link>)}
        </div>
        <div style={card}>
          <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Quick links</h2>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Link href="/payroll-hours" style={btnGhost}>Payroll Hours</Link><Link href="/labour" style={btnGhost}>Labour Cost</Link><Link href="/budget" style={btnGhost}>Budget Tool</Link><Link href="/wages" style={btnGhost}>Wages & Rules</Link></div>
        </div>
      </section>
    </main>
  );
}

function WatchList({title,color,rows,empty}:{title:string;color:string;rows:string[];empty:string}) {
  return <div style={{marginTop:12}}><div style={{fontSize:12,fontWeight:800,color,marginBottom:6}}>{title}</div>{rows.length===0 ? <div style={{fontSize:11,color:'#6b7280'}}>{empty}</div> : rows.map(row=><div key={row} style={{fontSize:12,color:'#e5e7eb',padding:'5px 0',borderTop:'1px solid rgba(255,255,255,.05)'}}>{row}</div>)}</div>;
}

const th:React.CSSProperties = { textAlign:'left',padding:'9px 8px',fontSize:10 };
const td:React.CSSProperties = { padding:'10px 8px',verticalAlign:'top' };
