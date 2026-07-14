'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,CartesianGrid } from 'recharts';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';
import { payrollLocationView, type PayrollReportRow } from '@/lib/payroll-report';

type PayrollRow = { employee_name:string; location:string; department:string; role:string;
  gross_hours:number; break_hours:number; payable_hours:number; rounded_hours:number; cheque_hours:number; cash_hours:number;
  wage:number; payroll_amount:number; cash_amount:number; rule_applied:string; };
type LabourGroupRow = { group:'Back of House'|'Front of House'|'Managers'|'Other'; location:string; hours:number; cost:number; employees:number };
type DailyGroupRow = LabourGroupRow & { date:string };
type SaleRow = { sale_date:string; location:string; net_sales:number; projected_sales:number; actual_labor_cost:number; labor_percent:number|null };
type ManagementDay={date:string;actualSales:number;projectedSales:number;hours:number;cost:number;boh:{hours:number;cost:number};foh:{hours:number;cost:number};managers:{hours:number;cost:number}};

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cad=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const cadFull=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n||0);
const sel:React.CSSProperties={background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer'};
const inp:React.CSSProperties={background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,color:'#f9fafb',padding:'6px 10px',fontSize:13,outline:'none'};
function isoDate(d:Date){return d.toISOString().split('T')[0];}
function reportLocationRows(reportRows:PayrollReportRow[]):PayrollRow[]{return reportRows.flatMap(row=>row.locations.map(location=>{const local=payrollLocationView(row,location);return{employee_name:row.employee_name,location,department:row.roles[0]||'',role:row.roles.join(', ')||'Unknown',gross_hours:local.gross_hours,break_hours:local.break_hours,payable_hours:local.payable_hours,rounded_hours:local.rounded_hours,cheque_hours:local.cheque_hours,cash_hours:local.cash_hours,wage:local.wage,payroll_amount:local.cheque_pay,cash_amount:local.cash_pay,rule_applied:local.rule_type};}));}
function ManagementMatrix({days}:{days:ManagementDay[]}){const totals=days.reduce((sum,day)=>({actualSales:sum.actualSales+day.actualSales,projectedSales:sum.projectedSales+day.projectedSales,hours:sum.hours+day.hours,cost:sum.cost+day.cost,boh:{hours:sum.boh.hours+day.boh.hours,cost:sum.boh.cost+day.boh.cost},foh:{hours:sum.foh.hours+day.foh.hours,cost:sum.foh.cost+day.foh.cost},managers:{hours:sum.managers.hours+day.managers.hours,cost:sum.managers.cost+day.managers.cost}}),{actualSales:0,projectedSales:0,hours:0,cost:0,boh:{hours:0,cost:0},foh:{hours:0,cost:0},managers:{hours:0,cost:0}});const moneyCell=(value:number,color:string)=><span style={{color,fontWeight:600}}>{value?cadFull(value):'—'}</span>;const groupCell=(group:{hours:number;cost:number},sales:number,color:string)=><div><div style={{color,fontWeight:650}}>{sales?`${(group.cost/sales*100).toFixed(1)}%`:'—'}</div><div style={{fontSize:10,color:'#9ca3af'}}>{group.hours.toFixed(2)} payable h</div><div style={{fontSize:10,color:'#6b7280'}}>{cadFull(group.cost)}</div></div>;const labelStyle:React.CSSProperties={padding:'9px 12px',position:'sticky',left:0,background:'#131720',zIndex:1,fontWeight:600,color:'#e5e7eb',minWidth:145};const cellStyle:React.CSSProperties={padding:'9px 12px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,.05)',minWidth:112};return <div style={{background:'#131720',border:'1px solid rgba(255,255,255,.07)',borderRadius:12,overflow:'hidden',marginBottom:20}}><div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,.07)'}}><div style={{fontSize:13,fontWeight:700,color:'#f9fafb'}}>Management Daily Labour Matrix</div><div style={{fontSize:10,color:'#6b7280',marginTop:2}}>Sales, labour cost and payable hours by department · scroll horizontally for longer periods</div></div><div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',fontSize:11,minWidth:'100%'}}><thead><tr style={{background:'rgba(0,0,0,.2)'}}><th style={{...labelStyle,fontSize:9,color:'#6b7280',textTransform:'uppercase'}}>Metric</th>{days.map(day=><th key={day.date} style={{...cellStyle,color:'#9ca3af'}}><div>{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-CA',{weekday:'short'})}</div><div style={{fontSize:9,color:'#6b7280'}}>{day.date.slice(5)}</div></th>)}<th style={{...cellStyle,color:'#22d3ee'}}>Period Total</th></tr></thead><tbody><tr style={{borderTop:'1px solid rgba(255,255,255,.05)'}}><td style={labelStyle}>Actual Sales</td>{days.map(day=><td key={day.date} style={cellStyle}>{moneyCell(day.actualSales,'#34d399')}</td>)}<td style={cellStyle}>{moneyCell(totals.actualSales,'#34d399')}</td></tr><tr style={{borderTop:'1px solid rgba(255,255,255,.05)'}}><td style={labelStyle}>Projected Sales</td>{days.map(day=><td key={day.date} style={cellStyle}>{moneyCell(day.projectedSales,'#9ca3af')}</td>)}<td style={cellStyle}>{moneyCell(totals.projectedSales,'#9ca3af')}</td></tr><tr style={{borderTop:'1px solid rgba(255,255,255,.05)'}}><td style={labelStyle}>Total Labour</td>{days.map(day=><td key={day.date} style={cellStyle}>{moneyCell(day.cost,'#a78bfa')}</td>)}<td style={cellStyle}>{moneyCell(totals.cost,'#a78bfa')}</td></tr><tr style={{borderTop:'1px solid rgba(255,255,255,.05)'}}><td style={labelStyle}>Labour %</td>{days.map(day=><td key={day.date} style={{...cellStyle,color:day.actualSales&&day.cost/day.actualSales>.35?'#f87171':'#fbbf24',fontWeight:700}}>{day.actualSales?`${(day.cost/day.actualSales*100).toFixed(1)}%`:'—'}</td>)}<td style={{...cellStyle,color:'#fbbf24',fontWeight:700}}>{totals.actualSales?`${(totals.cost/totals.actualSales*100).toFixed(1)}%`:'—'}</td></tr><tr style={{borderTop:'1px solid rgba(255,255,255,.05)'}}><td style={labelStyle}>Payable Hours</td>{days.map(day=><td key={day.date} style={{...cellStyle,color:'#22d3ee'}}>{day.hours.toFixed(2)}h</td>)}<td style={{...cellStyle,color:'#22d3ee',fontWeight:700}}>{totals.hours.toFixed(2)}h</td></tr>{([['Back of House','boh','#f97316'],['Front of House','foh','#22d3ee'],['Managers','managers','#a78bfa']] as const).map(([label,key,color])=><tr key={key} style={{borderTop:'1px solid rgba(255,255,255,.06)'}}><td style={{...labelStyle,color}}>{label}<div style={{fontSize:9,color:'#6b7280',fontWeight:400}}>% · payable hours · cost</div></td>{days.map(day=><td key={day.date} style={cellStyle}>{groupCell(day[key],day.actualSales,color)}</td>)}<td style={cellStyle}>{groupCell(totals[key],totals.actualSales,color)}</td></tr>)}</tbody></table></div></div>}

export default function LabourPage() {
  const today=new Date();
  const [preset,setPreset]=useState('month');
  const [fromDate,setFromDate]=useState(isoDate(new Date(today.getFullYear(),today.getMonth(),1)));
  const [toDate,setToDate]=useState(isoDate(new Date(today.getFullYear(),today.getMonth()+1,0)));
  const initialUrl=`/api/payroll?year=${today.getFullYear()}&month=${today.getMonth()+1}&period=month&from=${fromDate}&to=${toDate}&breakdown=departments-v3`;
  const initialReportUrl=`/api/payroll-report?start=${fromDate}&end=${toDate}`;
  const initialTrendsUrl=`/api/payroll?year=${today.getFullYear()}&month=${today.getMonth()+1}&period=month&trends_only=true`;
  const initial=peekJson<{rows:PayrollRow[];locationRows:PayrollRow[];labourGroups:LabourGroupRow[];dailyLabourGroups:DailyGroupRow[]}>(initialUrl);
  const initialReport=peekJson<{rows:PayrollReportRow[]}>(initialReportUrl);
  const initialTrends=peekJson<{monthly:any[]}>(initialTrendsUrl);
  const [rows,setRows]=useState<PayrollRow[]>(()=>reportLocationRows(initialReport?.rows||[]));
  const [labourGroups,setLabourGroups]=useState<LabourGroupRow[]>(()=>initial?.labourGroups||[]);
  const [dailyLabourGroups,setDailyLabourGroups]=useState<DailyGroupRow[]>(()=>initial?.dailyLabourGroups||[]);
  const [dailySales,setDailySales]=useState<SaleRow[]>([]);
  const [monthly,setMonthly]=useState<any[]>(()=>initialTrends?.monthly||[]);
  const [loading,setLoading]=useState(()=>!initialReport);
  const [locationFilter,setLocationFilter]=useState('ALL');
  const [syncing,setSyncing]=useState(false);
  const [syncMessage,setSyncMessage]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [sales,setSales]=useState<Record<string,number>>({});
  const [editSales,setEditSales]=useState(false);
  const [salesInput,setSalesInput]=useState<Record<string,string>>({});

  const applyPreset=useCallback((p:string)=>{
    setPreset(p);
    const now=new Date(); const y=now.getFullYear(); const m=now.getMonth();
    if(p==='today'){const d=isoDate(now);setFromDate(d);setToDate(d);}
    else if(p==='yesterday'){const d=new Date(now);d.setDate(d.getDate()-1);const s=isoDate(d);setFromDate(s);setToDate(s);}
    else if(p==='week'){const d=new Date(now);d.setDate(d.getDate()-6);setFromDate(isoDate(d));setToDate(isoDate(now));}
    else if(p==='1-15'){setFromDate(`${y}-${String(m+1).padStart(2,'0')}-01`);setToDate(`${y}-${String(m+1).padStart(2,'0')}-15`);}
    else if(p==='16-end'){const last=new Date(y,m+1,0);setFromDate(`${y}-${String(m+1).padStart(2,'0')}-16`);setToDate(isoDate(last));}
    else if(p==='month'){setFromDate(isoDate(new Date(y,m,1)));setToDate(isoDate(new Date(y,m+1,0)));}
    else if(p==='last-month'){setFromDate(isoDate(new Date(y,m-1,1)));setToDate(isoDate(new Date(y,m,0)));}
  },[]);

  useEffect(()=>{
    const year=new Date(fromDate).getFullYear();
    const month=new Date(fromDate).getMonth()+1;
    const url=`/api/payroll?year=${year}&month=${month}&period=month&from=${fromDate}&to=${toDate}&breakdown=departments-v3`;
    const reportUrl=`/api/payroll-report?start=${fromDate}&end=${toDate}`;
    const trendsUrl=`/api/payroll?year=${year}&month=${month}&period=month&trends_only=true`;
    const cached=peekJson<{rows:PayrollRow[];locationRows:PayrollRow[];labourGroups:LabourGroupRow[];dailyLabourGroups:DailyGroupRow[]}>(url);
    const cachedReport=peekJson<{rows:PayrollReportRow[]}>(reportUrl);
    const cachedTrends=peekJson<{monthly:any[]}>(trendsUrl);
    if(cachedReport)setRows(reportLocationRows(cachedReport.rows||[]));
    if(cached){setLabourGroups(cached.labourGroups||[]);setDailyLabourGroups(cached.dailyLabourGroups||[]);}
    if(cachedTrends)setMonthly(cachedTrends.monthly||[]);
    setLoading(!cachedReport);
    const periodRequest=cachedJson<{rows:PayrollRow[];locationRows:PayrollRow[];labourGroups:LabourGroupRow[];dailyLabourGroups:DailyGroupRow[]}>(url,600_000)
      .then(d=>{setLabourGroups(d.labourGroups||[]);setDailyLabourGroups(d.dailyLabourGroups||[]);});
    cachedJson<{rows:PayrollReportRow[]}>(reportUrl,600_000)
      .then(d=>setRows(reportLocationRows(d.rows||[])))
      .finally(()=>setLoading(false));
    periodRequest.then(()=>cachedJson<{monthly:any[]}>(trendsUrl,600_000).then(d=>setMonthly(d.monthly||[]))).catch(()=>{});
    cachedJson<{sales:SaleRow[]}>(`/api/sales?from=${fromDate}&to=${toDate}`,120_000).then(d=>setDailySales(d.sales||[])).catch(()=>setDailySales([]));
  },[fromDate,toDate,refresh]);

  const locations=useMemo(()=>[...new Set(rows.map(row=>row.location).filter(Boolean))].sort(),[rows]);
  const filteredRows=useMemo(()=>locationFilter==='ALL'?rows:rows.filter(row=>row.location===locationFilter),[rows,locationFilter]);

  const byLocation=useMemo(()=>{
    const map=new Map<string,any>();
    for(const r of filteredRows){
      const l=r.location||'Unknown';
      if(!map.has(l))map.set(l,{loc:l,gross:0,breaks:0,payable:0,rounded:0,chequeHours:0,cashHours:0,payroll:0,cash:0,headcount:0});
      const e=map.get(l);e.gross+=r.gross_hours;e.breaks+=r.break_hours;e.payable+=r.payable_hours;e.rounded+=r.rounded_hours;e.chequeHours+=r.cheque_hours;e.cashHours+=r.cash_hours;e.payroll+=r.payroll_amount;e.cash+=r.cash_amount;e.headcount++;
    }
    return [...map.values()].sort((a,b)=>b.payroll+b.cash-a.payroll-a.cash);
  },[filteredRows]);

  const byRole=useMemo(()=>{
    const map=new Map<string,any>();
    for(const r of filteredRows){
      const k=r.role||'Unknown';
      if(!map.has(k))map.set(k,{role:k,hours:0,cost:0,count:0});
      const e=map.get(k);e.hours+=r.payable_hours;e.cost+=r.payroll_amount+r.cash_amount;e.count++;
    }
    return [...map.values()].sort((a,b)=>b.cost-a.cost).slice(0,10);
  },[filteredRows]);

  const groupedLabour=useMemo(()=>{
    const order=['Back of House','Front of House','Managers'];
    return order.map(group=>{
      const matches=labourGroups.filter(row=>row.group===group&&(locationFilter==='ALL'||row.location===locationFilter));
      return {
        group,
        hours:matches.reduce((sum,row)=>sum+row.hours,0),
        cost:matches.reduce((sum,row)=>sum+row.cost,0),
        employees:matches.reduce((sum,row)=>sum+row.employees,0),
      };
    });
  },[labourGroups,locationFilter]);
  const groupedLabourCost=groupedLabour.reduce((sum,row)=>sum+row.cost,0);
  const managementDays=useMemo(()=>{const days:string[]=[];const current=new Date(`${fromDate}T12:00:00`);const end=new Date(`${toDate}T12:00:00`);while(current<=end&&days.length<31){days.push(isoDate(current));current.setDate(current.getDate()+1);}return days;},[fromDate,toDate]);
  const management=useMemo(()=>managementDays.map(date=>{const groups=dailyLabourGroups.filter(row=>row.date===date&&(locationFilter==='ALL'||row.location===locationFilter));const salesRows=dailySales.filter(row=>row.sale_date===date&&(locationFilter==='ALL'||row.location===locationFilter));const rawByGroup=(group:string)=>groups.filter(row=>row.group===group).reduce((sum,row)=>({hours:sum.hours+row.hours,cost:sum.cost+row.cost}),{hours:0,cost:0});const actualSales=salesRows.reduce((sum,row)=>sum+Number(row.net_sales||0),0);const projectedSales=salesRows.reduce((sum,row)=>sum+Number(row.projected_sales||0),0);const hours=groups.reduce((sum,row)=>sum+row.hours,0);const punchCost=groups.reduce((sum,row)=>sum+row.cost,0);const sevenShiftsCost=salesRows.reduce((sum,row)=>sum+Number(row.actual_labor_cost||0),0);const cost=sevenShiftsCost>0?sevenShiftsCost:punchCost;const scale=punchCost>0&&sevenShiftsCost>0?sevenShiftsCost/punchCost:1;const byGroup=(group:string)=>{const value=rawByGroup(group);return{hours:value.hours,cost:value.cost*scale};};return{date,actualSales,projectedSales,hours,cost,boh:byGroup('Back of House'),foh:byGroup('Front of House'),managers:byGroup('Managers')};}),[managementDays,dailyLabourGroups,dailySales,locationFilter]);
  const syncedSalesByLocation=useMemo(()=>dailySales.reduce((map,row)=>{map[row.location]=(map[row.location]||0)+Number(row.net_sales||0);return map;},{} as Record<string,number>),[dailySales]);

  const syncSelectedRange=async()=>{
    if(syncing)return;
    setSyncing(true);setSyncMessage('');
    try{
      const [punchResponse,salesResponse]=await Promise.all([
        fetch('/api/7shifts/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:`${fromDate}T00:00:00.000Z`,end:`${toDate}T23:59:59.999Z`,triggered_by:'labour-cost',sync_wages:true})}),
        fetch('/api/sales-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start_date:fromDate,end_date:toDate})}),
      ]);
      const [punchResult,salesResult]=await Promise.all([punchResponse.json(),salesResponse.json()]);
      if(!punchResponse.ok||punchResult.ok===false)throw new Error(punchResult.error||'Punch sync failed');
      if(!salesResponse.ok||salesResult.ok===false)throw new Error(salesResult.error||salesResult.errors?.join(' · ')||'Sales sync failed');
      invalidateClientCache(['/api/payroll','/api/payroll-report','/api/sales']);
      setRefresh(value=>value+1);
      setSyncMessage(`Updated ${punchResult.synced?.punches||0} punches and ${salesResult.synced||0} sales records`);
    }catch(error:any){setSyncMessage(`Sync failed: ${error.message}`);}finally{setSyncing(false);}
  };

  const grand={
    gross:filteredRows.reduce((s,r)=>s+r.gross_hours,0),
    breaks:filteredRows.reduce((s,r)=>s+r.break_hours,0),
    payable:filteredRows.reduce((s,r)=>s+r.payable_hours,0),
    rounded:filteredRows.reduce((s,r)=>s+r.rounded_hours,0),
    chequeHours:filteredRows.reduce((s,r)=>s+r.cheque_hours,0),
    cashHours:filteredRows.reduce((s,r)=>s+r.cash_hours,0),
    payroll:filteredRows.reduce((s,r)=>s+r.payroll_amount,0),
    cash:filteredRows.reduce((s,r)=>s+r.cash_amount,0),
    heads:filteredRows.length,
  };

  const saveSales=()=>{
    const next={...sales};
    for(const[k,v]of Object.entries(salesInput)){const n=parseFloat(v);if(!isNaN(n))next[k]=n;}
    setSales(next);setEditSales(false);
  };

  const PRESET_BTNS=[
    {k:'today',l:'Today'},{k:'yesterday',l:'Yesterday'},{k:'week',l:'Last 7 days'},
    {k:'1-15',l:'1–15'},{k:'16-end',l:'16–End'},{k:'month',l:'This month'},
    {k:'last-month',l:'Last month'},{k:'custom',l:'Custom'},
  ];

  return(
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'#f9fafb',margin:0}}>Labour & Cost Monitor</h1>
          <p style={{color:'#6b7280',fontSize:13,margin:'4px 0 0'}}>{fromDate} → {toDate}</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={syncSelectedRange} disabled={syncing} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:syncing?'#6b7280':'#22d3ee',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:syncing?'wait':'pointer'}}>{syncing?'Syncing…':'↻ Sync 7shifts'}</button>
          <button onClick={()=>window.location.href=`/api/export?from=${fromDate}&to=${toDate}&type=full`} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer'}}>↓ Export Excel</button>
          <button onClick={()=>{setSalesInput(Object.fromEntries(byLocation.map(l=>[l.loc,String(sales[l.loc]??syncedSalesByLocation[l.loc]??'')])));setEditSales(true);}} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer'}}>Enter sales</button>
        </div>
      </div>
      {syncMessage&&<div role="status" style={{fontSize:11,color:syncMessage.startsWith('Updated')?'#34d399':'#f87171',margin:'-8px 0 12px'}}>{syncMessage}</div>}

      {/* Date presets */}
      <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <select aria-label="Labour location" value={locationFilter} onChange={event=>setLocationFilter(event.target.value)} style={sel}>
          <option value="ALL">All locations</option>
          {locations.map(location=><option key={location}>{location}</option>)}
        </select>
        {PRESET_BTNS.map(b=>(
          <button key={b.k} onClick={()=>applyPreset(b.k)} style={{
            padding:'5px 12px',fontSize:12,borderRadius:6,cursor:'pointer',
            background:preset===b.k?'rgba(34,211,238,0.15)':'rgba(255,255,255,0.04)',
            color:preset===b.k?'#22d3ee':'#9ca3af',
            border:preset===b.k?'1px solid rgba(34,211,238,0.3)':'1px solid rgba(255,255,255,0.06)',
          }}>{b.l}</button>
        ))}
        {preset==='custom'&&(
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{...inp,width:130}}/>
            <span style={{color:'#6b7280'}}>→</span>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{...inp,width:130}}/>
          </div>
        )}
      </div>

      {/* 7shifts department breakdown */}
      <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',marginBottom:20}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9fafb'}}>7shifts payable labour by department</div>
          <div style={{fontSize:10,color:'#6b7280',marginTop:2}}>Completed punches · payable hours and cost use the wage stored for each 7shifts employee</div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(180px,1fr))'}}>
          {groupedLabour.map((row,index)=>{
            const colors=['#f97316','#22d3ee','#a78bfa'];
            const percent=groupedLabourCost>0?row.cost/groupedLabourCost:0;
            return <div key={row.group} style={{padding:'16px 18px',borderLeft:index?'1px solid rgba(255,255,255,0.06)':'none'}}>
              <div style={{fontSize:11,fontWeight:700,color:colors[index],textTransform:'uppercase',letterSpacing:'0.05em'}}>{row.group}</div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:5}}>
                <span style={{fontSize:21,fontWeight:700,color:'#f9fafb'}}>{cad(row.cost)}</span>
                <span style={{fontSize:12,color:'#9ca3af'}}>{(percent*100).toFixed(1)}%</span>
              </div>
              <div style={{fontSize:11,color:'#6b7280',marginTop:4}}>{row.hours.toFixed(1)} payable hours · {row.employees} staff assignments</div>
            </div>;
          })}
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <thead><tr style={{background:'rgba(0,0,0,0.18)'}}>{['Department','Payable hours','Labour cost','Cost/payable hr','% of labour'].map(header=><th key={header} style={{padding:'8px 16px',textAlign:header==='Department'?'left':'right',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase'}}>{header}</th>)}</tr></thead>
          <tbody>{groupedLabour.map(row=><tr key={row.group} style={{borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            <td style={{padding:'9px 16px',fontWeight:600,color:'#e5e7eb'}}>{row.group}</td>
            <td style={{padding:'9px 16px',textAlign:'right',color:'#22d3ee'}}>{row.hours.toFixed(2)}h</td>
            <td style={{padding:'9px 16px',textAlign:'right',color:'#a78bfa',fontWeight:600}}>{cadFull(row.cost)}</td>
            <td style={{padding:'9px 16px',textAlign:'right',color:'#9ca3af'}}>{cadFull(row.hours?row.cost/row.hours:0)}</td>
            <td style={{padding:'9px 16px',textAlign:'right',color:'#fbbf24'}}>{groupedLabourCost?`${(row.cost/groupedLabourCost*100).toFixed(1)}%`:'—'}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <ManagementMatrix days={management}/>

      {/* Sales modal */}
      {editSales&&(
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontSize:14,fontWeight:600,color:'#f9fafb',marginBottom:12}}>Enter sales by location</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
            {byLocation.map(l=>(
              <div key={l.loc} style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:12,color:'#9ca3af',minWidth:160}}>{l.loc}</span>
                <span style={{color:'#6b7280'}}>$</span>
                <input type="number" placeholder="0" value={salesInput[l.loc]||''}
                  onChange={e=>setSalesInput(p=>({...p,[l.loc]:e.target.value}))} style={{...sel,width:100,padding:'5px 8px'}}/>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={saveSales} style={{background:'#22d3ee',color:'#0a0c10',border:'none',borderRadius:7,padding:'7px 20px',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save</button>
            <button onClick={()=>setEditSales(false)} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      )}

      {/* KPI */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:20}}>
        {[
          {l:'Gross hours',v:`${grand.gross.toFixed(1)}h`,c:'#22d3ee'},
          {l:'Break hours',v:`${grand.breaks.toFixed(1)}h`,c:'#60a5fa'},
          {l:'Payable hours',v:`${grand.payable.toFixed(1)}h`,c:'#34d399'},
          {l:'Cheque cost',v:cad(grand.payroll),c:'#34d399'},
          {l:'Cash cost',v:cad(grand.cash),c:'#fbbf24'},
          {l:'Total labour',v:cad(grand.payroll+grand.cash),c:'#a78bfa'},
          {l:'Employee rows',v:grand.heads,c:'#60a5fa'},
          {l:'Cost/payable hr',v:`$${grand.payable>0?((grand.payroll+grand.cash)/grand.payable).toFixed(2):0}`,c:'#f87171'},
        ].map(k=>(
          <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em'}}>{k.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Labour cost by location</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byLocation.slice(0,8)} layout="vertical" margin={{left:130,right:20}}>
              <XAxis type="number" tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="loc" tick={{fill:'#9ca3af',fontSize:11}} width={130}/>
              <Tooltip formatter={(v:any)=>cadFull(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="payroll" name="Payroll" fill="#34d399" radius={[0,4,4,0]} stackId="a"/>
              <Bar dataKey="cash"    name="Cash"    fill="#fbbf24" radius={[0,4,4,0]} stackId="a"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Cost by role (top 10)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byRole} layout="vertical" margin={{left:100,right:20}}>
              <XAxis type="number" tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="role" tick={{fill:'#9ca3af',fontSize:11}} width={100}/>
              <Tooltip formatter={(v:any)=>cadFull(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="cost" name="Cost" fill="#a78bfa" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Location table */}
      <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',marginBottom:20}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>Location breakdown</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
            {['Location','Staff','Gross hrs','Break hrs','Payable hrs','Cheque $','Cash $','Total cost','Cost/payable hr','Sales','Labour %'].map(h=>(
              <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byLocation.map((l,i)=>{
              const total=l.payroll+l.cash;
              const sale=Object.prototype.hasOwnProperty.call(sales,l.loc)?sales[l.loc]:(syncedSalesByLocation[l.loc]||0);
              const labPct=sale>0?total/sale:null;
              return(
                <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                  <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{l.loc}</td>
                  <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.headcount}</td>
                  <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{l.gross.toFixed(1)}h</td>
                  <td style={{padding:'9px 14px',color:'#60a5fa',textAlign:'right'}}>{l.breaks.toFixed(1)}h</td>
                  <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{l.payable.toFixed(1)}h</td>
                  <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{cadFull(l.payroll)}</td>
                  <td style={{padding:'9px 14px',color:'#fbbf24',textAlign:'right'}}>{cadFull(l.cash)}</td>
                  <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cadFull(total)}</td>
                  <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${l.payable>0?(total/l.payable).toFixed(2):0}</td>
                  <td style={{padding:'9px 14px',color:sale>0?'#f9fafb':'#4b5563',textAlign:'right'}}>{sale>0?cad(sale):'—'}</td>
                  <td style={{padding:'9px 14px',textAlign:'right'}}>
                    {labPct!=null?<span style={{fontWeight:600,color:labPct>0.35?'#f87171':labPct>0.25?'#fbbf24':'#34d399'}}>{(labPct*100).toFixed(1)}%</span>:<span style={{color:'#4b5563'}}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Monthly trend */}
      {monthly.filter(m=>m.totalHours>0).length>0&&(
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Monthly labour trend</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={monthly.filter(m=>m.totalHours>0)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/>
              <YAxis tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={(v:any)=>cadFull(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Line type="monotone" dataKey="payrollAmount" stroke="#34d399" strokeWidth={2} dot={false} name="Payroll"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
