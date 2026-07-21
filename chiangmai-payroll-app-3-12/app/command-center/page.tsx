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

const card:React.CSSProperties = { background:'#131720', border:'1px solid rgba(255,255,255,.08)', borderRadius:14, padding:16 };
const muted:React.CSSProperties = { color:'#6b7280', fontSize:12, lineHeight:1.45 };
const sel:React.CSSProperties = { background:'#1a1f2e', border:'1px solid rgba(255,255,255,.1)', borderRadius:8, color:'#e5e7eb', padding:'8px 11px', fontSize:13, outline:'none' };
const btn:React.CSSProperties = { background:'rgba(34,211,238,.12)', border:'1px solid rgba(34,211,238,.28)', color:'#22d3ee', borderRadius:8, padding:'8px 12px', fontSize:12, fontWeight:700, textDecoration:'none', cursor:'pointer' };
const btnGreen:React.CSSProperties = { ...btn, background:'rgba(52,211,153,.1)', border:'1px solid rgba(52,211,153,.28)', color:'#34d399' };
const btnGhost:React.CSSProperties = { ...btn, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)', color:'#9ca3af' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const pad2 = (value:number) => String(value).padStart(2,'0');
const isoDate = (date:Date) => `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
const cad = (value:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(value||0);
const cadFull = (value:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(value||0);
const hrs = (value:number) => `${(value||0).toFixed(2)}h`;
const pct = (value:number) => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : '—';

function periodRange(year:number,month:number,period:string){
  const prefix = `${year}-${pad2(month)}`;
  const last = pad2(new Date(year,month,0).getDate());
  if (period === '1-15') return { start:`${prefix}-01`, end:`${prefix}-15`, label:`${MONTHS[month-1]} 1–15, ${year}` };
  if (period === '16-end') return { start:`${prefix}-16`, end:`${prefix}-${last}`, label:`${MONTHS[month-1]} 16–${Number(last)}, ${year}` };
  return { start:`${prefix}-01`, end:`${prefix}-${last}`, label:`${MONTHS[month-1]} full month, ${year}` };
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
  const now = new Date();
  const [year,setYear] = useState(now.getFullYear());
  const [month,setMonth] = useState(now.getMonth()+1);
  const [period,setPeriod] = useState(now.getDate() <= 15 ? '1-15' : '16-end');
  const [forceToken,setForceToken] = useState(0);
  const range = useMemo(()=>periodRange(year,month,period),[year,month,period]);
  const today = isoDate(now);
  const reportUrl = `/api/payroll-report?start=${range.start}&end=${range.end}`;
  const todayReportUrl = `/api/payroll-report?start=${today}&end=${today}`;
  const salesUrl = `/api/sales?from=${range.start}&to=${range.end}`;
  const todaySalesUrl = `/api/sales?from=${today}&to=${today}`;
  const alertsUrl = `/api/alerts?from=${range.start}&to=${range.end}`;
  const employeesUrl = '/api/employees?active=true';

  const [report,setReport] = useState<ReportApi|undefined>(()=>peekJson<ReportApi>(reportUrl));
  const [todayReport,setTodayReport] = useState<ReportApi|undefined>(()=>peekJson<ReportApi>(todayReportUrl));
  const [sales,setSales] = useState<SaleRow[]>(()=>peekJson<{sales:SaleRow[]}>(salesUrl)?.sales || []);
  const [todaySales,setTodaySales] = useState<SaleRow[]>(()=>peekJson<{sales:SaleRow[]}>(todaySalesUrl)?.sales || []);
  const [alerts,setAlerts] = useState<AlertRow[]>(()=>peekJson<{alerts:AlertRow[]}>(alertsUrl)?.alerts || []);
  const [employees,setEmployees] = useState<EmployeeRow[]>(()=>peekJson<{employees:EmployeeRow[]}>(employeesUrl)?.employees || []);
  const [loading,setLoading] = useState(!report);
  const [error,setError] = useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(!peekJson<ReportApi>(reportUrl));
    setError('');
    Promise.all([
      cachedJson<ReportApi>(reportUrl,120_000,forceToken>0),
      cachedJson<ReportApi>(todayReportUrl,60_000,forceToken>0),
      cachedJson<{sales:SaleRow[]}>(salesUrl,120_000,forceToken>0),
      cachedJson<{sales:SaleRow[]}>(todaySalesUrl,60_000,forceToken>0),
      cachedJson<{alerts:AlertRow[]}>(alertsUrl,60_000,forceToken>0),
      cachedJson<{employees:EmployeeRow[]}>(employeesUrl,120_000,forceToken>0),
    ]).then(([periodReport,todayData,salesData,todaySalesData,alertData,employeeData])=>{
      if (cancelled) return;
      setReport(periodReport); setTodayReport(todayData);
      setSales(salesData.sales || []); setTodaySales(todaySalesData.sales || []);
      setAlerts(alertData.alerts || []); setEmployees(employeeData.employees || []);
    }).catch((err:any)=>{ if(!cancelled) setError(err.message || 'Command Center failed to load'); })
      .finally(()=>{ if(!cancelled) setLoading(false); });
    return ()=>{cancelled=true;};
  },[reportUrl,todayReportUrl,salesUrl,todaySalesUrl,alertsUrl,employeesUrl,forceToken]);

  const periodSales = useMemo(()=>sales.reduce((sum,row)=>sum+Number(row.net_sales ?? row.gross_sales ?? 0),0),[sales]);
  const todaySalesTotal = useMemo(()=>todaySales.reduce((sum,row)=>sum+Number(row.net_sales ?? row.gross_sales ?? 0),0),[todaySales]);
  const todaySummary = todayReport?.summary;
  const summary = report?.summary || {employees:0,gross_hours:0,break_hours:0,payable_hours:0,regular_payable_hours:0,holiday_hours:0,holiday_pay:0,rounded_hours:0,cheque_hours:0,cash_hours:0,cheque_pay:0,cash_pay:0,total_pay:0};
  const labourPct = periodSales ? summary.total_pay / periodSales : 0;
  const todayLabourPct = todaySalesTotal && todaySummary ? todaySummary.total_pay / todaySalesTotal : 0;

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
    {label:'Holiday pay rows', count:risks.holiday.length, status:'green' as const, href:'/payroll-hours'},
  ];

  const payrollExport = `/api/payroll-report/export?start=${range.start}&end=${range.end}`;
  const ownerExport = `/api/export?from=${range.start}&to=${range.end}`;
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
          <select value={year} onChange={event=>setYear(Number(event.target.value))} style={sel}>{[2025,2026,2027].map(item=><option key={item} value={item}>{item}</option>)}</select>
          <select value={month} onChange={event=>setMonth(Number(event.target.value))} style={sel}>{MONTHS.map((item,index)=><option key={item} value={index+1}>{item}</option>)}</select>
          <select value={period} onChange={event=>setPeriod(event.target.value)} style={sel}><option value="1-15">1–15</option><option value="16-end">16–End</option><option value="month">Full month</option></select>
          <button onClick={()=>setForceToken(value=>value+1)} style={btnGhost}>{loading?'Refreshing…':'Refresh'}</button>
        </div>
      </div>

      {error&&<div role="alert" style={{...card,border:'1px solid rgba(248,113,113,.35)',color:'#f87171',marginBottom:16}}>{error}</div>}

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:16}}>
        {[
          ['Today Sales', todaySalesTotal ? cad(todaySalesTotal) : 'No sales yet', '#34d399'],
          ['Today Labour', todaySummary ? cad(todaySummary.total_pay) : '—', '#a78bfa'],
          ['Today Labour %', todayLabourPct ? pct(todayLabourPct) : '—', todayLabourPct>.35?'#f87171':todayLabourPct>.3?'#fbbf24':'#34d399'],
          ['Period Cheque Hrs', hrs(summary.cheque_hours), '#a78bfa'],
          ['Period Cash Hrs', hrs(summary.cash_hours), '#fbbf24'],
          ['Period Total Pay', cad(summary.total_pay), '#34d399'],
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
          <p style={{...muted,margin:'0 0 12px'}}>Compares period labour cost to sales by location. Use red/yellow rows to decide where to reduce or rebalance hours.</p>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{color:'#6b7280',textTransform:'uppercase',letterSpacing:'.07em'}}><th style={th}>Location</th><th style={th}>Staff</th><th style={th}>Payable</th><th style={th}>Labour</th><th style={th}>Sales</th><th style={th}>Labour %</th><th style={th}>Alerts</th></tr></thead>
              <tbody>{locationRows.slice(0,12).map(row=>{
                const color = row.sales ? (row.labourPct>.35?'#f87171':row.labourPct>.3?'#fbbf24':'#34d399') : '#6b7280';
                return <tr key={row.location} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={td}><Link href={`/location`} style={{color:'#e5e7eb',textDecoration:'none',fontWeight:700}}>{row.location}</Link></td><td style={td}>{row.staffCount}</td><td style={{...td,color:'#22d3ee'}}>{hrs(row.payable)}</td><td style={{...td,color:'#a78bfa'}}>{cad(row.cost)}</td><td style={{...td,color:'#34d399'}}>{row.sales?cad(row.sales):'—'}</td><td style={{...td,color,fontWeight:800}}>{row.sales?pct(row.labourPct):'No sales'}</td><td style={{...td,color:row.alerts?'#fbbf24':'#6b7280'}}>{row.alerts || '—'}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>

        <div style={card}>
          <h2 style={{fontSize:17,margin:'0 0 4px',color:'#f9fafb'}}>People to watch</h2>
          <p style={{...muted,margin:'0 0 12px'}}>Current pay-period risks from actual synced punches. Forecast from future schedules is marked as a Phase 2 item.</p>
          <WatchList title="Near 88h" color="#fbbf24" rows={risks.nearCap.slice(0,7).map(row=>`${row.employee_name} · ${hrs(row.rounded_hours)}`)} empty="No one near 88h from current punches." />
          <WatchList title="Cash / exception rows" color="#f97316" rows={risks.overCash.slice(0,7).map(row=>`${row.employee_name} · ${hrs(row.cash_hours)} cash`)} empty="No cash split rows." />
          <WatchList title="Missing wages" color="#f87171" rows={risks.missingWages.slice(0,7).map(row=>row.full_name)} empty="No missing wages." />
        </div>
      </section>

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:14}}>
        <div style={card}>
          <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Forecast — Phase 2</h2>
          <p style={muted}>To predict expense ahead, the next engineering step is syncing 7shifts scheduled shifts. Then this card can show projected final hours, over-88 risks, and location over/under staffing before staff clock in.</p>
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
