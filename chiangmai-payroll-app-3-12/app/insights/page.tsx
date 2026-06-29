'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,CartesianGrid,PieChart,Pie,Cell } from 'recharts';

type Row = { employee_name:string; location:string; department:string; role:string;
  actual_hours:number; payroll_hours:number; cash_hours:number;
  wage:number; payroll_amount:number; cash_amount:number; rule_applied:string; };
type Sale = { sale_date:string; location:string; gross_sales:number; net_sales:number; covers:number; notes:string; };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LOCATIONS = ['Chiang Mai Liberty Village','Chiang Mai York Mills','Chiang Mai Junction','Chiang Mai Danforth','Imm Thai Kitchen','Chiang Mai Parklawn','Chiang Mai Mississauga'];
const cad = (n:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const cadFull = (n:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n||0);
const pct = (n:number,d:number) => d>0?`${((n/d)*100).toFixed(1)}%`:'—';
const COLORS = ['#22d3ee','#a78bfa','#34d399','#fbbf24','#f87171','#60a5fa','#fb923c'];

const sel: React.CSSProperties = {background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer'};
const inp: React.CSSProperties = {background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,color:'#f9fafb',padding:'6px 10px',fontSize:13,outline:'none'};

function isoDate(d: Date) { return d.toISOString().split('T')[0]; }

export default function InsightsPage() {
  // Date range state
  const today = new Date();
  const [preset,  setPreset]  = useState<string>('month');
  const [fromDate, setFromDate] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [toDate,   setToDate]   = useState(isoDate(today));
  const [locFilter, setLocFilter] = useState('ALL');

  // Data
  const [rows,    setRows]    = useState<Row[]>([]);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [sales,   setSales]   = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'overview'|'locations'|'roles'|'alerts'|'top'|'sales'>('overview');

  // Sales entry state
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [salesEntry, setSalesEntry] = useState<Record<string,{net:string;gross:string;covers:string}>>({});
  const [salesDate,  setSalesDate]  = useState(isoDate(today));
  const [savingSales, setSavingSales] = useState(false);
  const [salesMsg,   setSalesMsg]   = useState('');

  // Alert drill-down
  const [alertDetail, setAlertDetail] = useState<Row[]|null>(null);
  const [alertTitle,  setAlertTitle]  = useState('');

  // Apply preset
  const applyPreset = useCallback((p: string) => {
    setPreset(p);
    const now = new Date();
    const y = now.getFullYear(); const m = now.getMonth();
    const day = now.getDate();
    if (p==='today')  { const d=isoDate(now); setFromDate(d); setToDate(d); }
    else if (p==='yesterday') { const d=new Date(now); d.setDate(d.getDate()-1); const s=isoDate(d); setFromDate(s); setToDate(s); }
    else if (p==='week')  { const d=new Date(now); d.setDate(d.getDate()-6); setFromDate(isoDate(d)); setToDate(isoDate(now)); }
    else if (p==='1-15')  { setFromDate(`${y}-${String(m+1).padStart(2,'0')}-01`); setToDate(`${y}-${String(m+1).padStart(2,'0')}-15`); }
    else if (p==='16-end'){ const last=new Date(y,m+1,0); setFromDate(`${y}-${String(m+1).padStart(2,'0')}-16`); setToDate(isoDate(last)); }
    else if (p==='month') { setFromDate(isoDate(new Date(y,m,1))); setToDate(isoDate(new Date(y,m+1,0))); }
    else if (p==='last-month') { setFromDate(isoDate(new Date(y,m-1,1))); setToDate(isoDate(new Date(y,m,0))); }
    else if (p==='year')  { setFromDate(`${y}-01-01`); setToDate(`${y}-12-31`); }
  }, []);

  useEffect(() => {
    setLoading(true);
    const year = new Date(fromDate).getFullYear();
    const month = new Date(fromDate).getMonth() + 1;
    Promise.all([
      fetch(`/api/payroll?year=${year}&month=${month}&period=month&from=${fromDate}&to=${toDate}`).then(r=>r.json()),
      fetch(`/api/sales?from=${fromDate}&to=${toDate}`).then(r=>r.json()),
    ]).then(([pay, sal]) => {
      setRows(pay.rows || []);
      setMonthly(pay.monthly || []);
      setSales(sal.sales || []);
    }).finally(() => setLoading(false));
  }, [fromDate, toDate]);

  const filteredRows = useMemo(() =>
    locFilter === 'ALL' ? rows : rows.filter(r => r.location === locFilter)
  , [rows, locFilter]);

  const summary = useMemo(() => {
    const r = filteredRows;
    return {
      totalCost:   r.reduce((s,e)=>s+e.payroll_amount+e.cash_amount,0),
      payroll:     r.reduce((s,e)=>s+e.payroll_amount,0),
      cash:        r.reduce((s,e)=>s+e.cash_amount,0),
      hours:       r.reduce((s,e)=>s+e.actual_hours,0),
      headcount:   r.length,
      avgWage:     r.filter(e=>e.wage>0).length ? r.filter(e=>e.wage>0).reduce((s,e)=>s+e.wage,0)/r.filter(e=>e.wage>0).length : 0,
      zeroWage:    r.filter(e=>!e.wage||e.wage===0),
      overhours:   r.filter(e=>e.actual_hours>48),
      bigHours:    r.filter(e=>e.actual_hours>60),
      cashOnly:    r.filter(e=>e.rule_applied==='CASH_ONLY'),
      held:        r.filter(e=>e.rule_applied==='HOLD_PAYROLL'),
    };
  }, [filteredRows]);

  const totalSales = useMemo(() => {
    const filtered = locFilter === 'ALL' ? sales : sales.filter(s=>s.location===locFilter);
    return filtered.reduce((s,e)=>s+(+e.net_sales||+e.gross_sales||0),0);
  }, [sales, locFilter]);

  const byLocation = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of filteredRows) {
      const l = r.location||'Unknown';
      if (!map.has(l)) map.set(l,{loc:l,cost:0,hours:0,headcount:0,cash:0,payroll:0,sales:0});
      const e=map.get(l); e.cost+=r.payroll_amount+r.cash_amount; e.cash+=r.cash_amount;
      e.payroll+=r.payroll_amount; e.hours+=r.actual_hours; e.headcount++;
    }
    for (const s of sales) {
      const v = map.get(s.location) || map.get(s.location?.replace(' Village',''));
      if (v) v.sales += +s.net_sales||+s.gross_sales||0;
    }
    return [...map.values()].sort((a,b)=>b.cost-a.cost);
  }, [filteredRows, sales]);

  const byRole = useMemo(() => {
    const map = new Map<string,any>();
    for (const r of filteredRows) {
      const k=r.role||'Unknown';
      if(!map.has(k)) map.set(k,{role:k,cost:0,hours:0,count:0,wageSum:0});
      const e=map.get(k); e.cost+=r.payroll_amount+r.cash_amount; e.hours+=r.actual_hours; e.count++; e.wageSum+=r.wage||0;
    }
    return [...map.values()].map(r=>({...r,avgWage:r.count?r.wageSum/r.count:0})).sort((a,b)=>b.cost-a.cost);
  }, [filteredRows]);

  const byDept = useMemo(() => {
    const map = new Map<string,number>();
    for (const r of filteredRows) map.set(r.department?.trim()||'Unknown',(map.get(r.department?.trim()||'Unknown')||0)+r.payroll_amount+r.cash_amount);
    return [...map.entries()].map(([dept,cost])=>({dept,cost})).sort((a,b)=>b.cost-a.cost);
  }, [filteredRows]);

  const topEarners = useMemo(()=>[...filteredRows].sort((a,b)=>(b.payroll_amount+b.cash_amount)-(a.payroll_amount+a.cash_amount)).slice(0,20),[filteredRows]);

  const alerts = useMemo(()=>{
    const list:any[]=[];
    if(summary.zeroWage.length>0) list.push({type:'Missing Wage',sev:'high',msg:`${summary.zeroWage.length} employees have $0 wage — payroll calculated as $0`,rows:summary.zeroWage});
    if(summary.bigHours.length>0) list.push({type:'Excessive Hours 60h+',sev:'high',msg:`${summary.bigHours.length} employees worked 60+ hours — verify or apply cap rules`,rows:summary.bigHours});
    if(summary.overhours.length>0) list.push({type:'Overtime Risk 48h+',sev:'medium',msg:`${summary.overhours.length} employees exceeded 48h this period`,rows:summary.overhours});
    if(summary.held.length>0) list.push({type:'Payroll On Hold',sev:'medium',msg:`${summary.held.length} employees on hold — verify work permits`,rows:summary.held});
    if(summary.cash>summary.totalCost*0.15) list.push({type:'High Cash Payments',sev:'low',msg:`Cash is ${pct(summary.cash,summary.totalCost)} of total — review cash-only employees`,rows:summary.cashOnly});
    return list;
  },[summary]);

  const saveSales = async () => {
    setSavingSales(true);
    const rows = Object.entries(salesEntry)
      .filter(([,v])=>v.net||v.gross)
      .map(([loc,v])=>({ sale_date:salesDate, location:loc, net_sales:parseFloat(v.net)||0, gross_sales:parseFloat(v.gross)||0, covers:parseInt(v.covers)||0 }));
    if (!rows.length) { setSalesMsg('Enter at least one sale amount'); setSavingSales(false); return; }
    const res = await fetch('/api/sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});
    const d = await res.json();
    setSalesMsg(d.ok ? `✓ Saved ${d.saved} location(s)` : `Error: ${d.error}`);
    setSavingSales(false);
    if (d.ok) { setTimeout(()=>{ setShowSalesModal(false); setSalesMsg(''); setSalesEntry({}); },1500); }
  };

  const downloadExcel = () => {
    window.location.href = `/api/export?from=${fromDate}&to=${toDate}&type=full`;
  };

  const PRESET_BTNS = [
    {k:'today',l:'Today'},{k:'yesterday',l:'Yesterday'},{k:'week',l:'Last 7 days'},
    {k:'1-15',l:'1–15'},{k:'16-end',l:'16–End'},{k:'month',l:'This month'},
    {k:'last-month',l:'Last month'},{k:'year',l:'This year'},{k:'custom',l:'Custom'},
  ];

  const tabBtn = (t:string,label:string,badge?:number) => (
    <button key={t} onClick={()=>setTab(t as any)} style={{
      padding:'8px 14px',fontSize:12,cursor:'pointer',background:'transparent',border:'none',
      color:tab===t?'#f9fafb':'#6b7280',borderBottom:tab===t?'2px solid #22d3ee':'2px solid transparent',
      whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:6
    }}>
      {label}
      {badge!=null&&badge>0&&<span style={{background:'rgba(248,113,113,0.2)',color:'#f87171',borderRadius:10,padding:'1px 6px',fontSize:10}}>{badge}</span>}
    </button>
  );

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'20px 28px'}}>

      {/* Header + controls */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:20,fontWeight:700,color:'#f9fafb',margin:0}}>Management Insights</h1>
          <p style={{color:'#6b7280',fontSize:12,margin:'3px 0 0'}}>{fromDate} → {toDate} · <strong style={{color:'#9ca3af'}}>{filteredRows.length} workers with punches</strong> in this period</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <button onClick={()=>setShowSalesModal(true)} style={{background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)',color:'#fbbf24',borderRadius:7,padding:'7px 14px',fontSize:12,cursor:'pointer',fontWeight:500}}>
            + Enter Sales
          </button>
          <button onClick={downloadExcel} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,padding:'7px 14px',fontSize:12,cursor:'pointer',fontWeight:500}}>
            ↓ Export Excel
          </button>
          <select value={locFilter} onChange={e=>setLocFilter(e.target.value)} style={{...sel,maxWidth:220}}>
            <option value="ALL">All locations</option>
            {LOCATIONS.map(l=><option key={l}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Date presets */}
      <div style={{display:'flex',gap:4,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        {PRESET_BTNS.map(b=>(
          <button key={b.k} onClick={()=>applyPreset(b.k)} style={{
            padding:'5px 12px',fontSize:12,borderRadius:6,cursor:'pointer',
            background:preset===b.k?'rgba(34,211,238,0.15)':'rgba(255,255,255,0.04)',
            color:preset===b.k?'#22d3ee':'#9ca3af',
            border:preset===b.k?'1px solid rgba(34,211,238,0.3)':'1px solid rgba(255,255,255,0.06)',
          }}>{b.l}</button>
        ))}
        {preset==='custom'&&(
          <>
            <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{...inp,width:130}}/>
            <span style={{color:'#6b7280',fontSize:12}}>→</span>
            <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{...inp,width:130}}/>
          </>
        )}
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginBottom:16}}>
        {[
          {l:'Total Labour',v:cad(summary.totalCost),c:'#a78bfa'},
          {l:'Payroll (Cheque)',v:cad(summary.payroll),c:'#34d399'},
          {l:'Cash Payments',v:cad(summary.cash),c:'#fbbf24'},
          {l:'Total Hours',v:`${summary.hours.toFixed(0)}h`,c:'#22d3ee'},
          {l:'Workers this period',v:summary.headcount,c:'#60a5fa'},
          {l:'Avg Wage',v:`$${summary.avgWage.toFixed(2)}/hr`,c:'#f97316'},
          {l:'Sales',v:totalSales>0?cad(totalSales):'Enter sales',c:totalSales>0?'#34d399':'#4b5563'},
          {l:'Labour %',v:totalSales>0?pct(summary.totalCost,totalSales):'—',c:totalSales>0&&summary.totalCost/totalSales>0.35?'#f87171':totalSales>0&&summary.totalCost/totalSales>0.25?'#fbbf24':'#34d399'},
          {l:'Alerts',v:alerts.length,c:alerts.some(a=>a.sev==='high')?'#f87171':alerts.length>0?'#fbbf24':'#34d399'},
        ].map(k=>(
          <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'9px 12px'}}>
            <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',lineHeight:1.4}}>{k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{borderBottom:'1px solid rgba(255,255,255,0.07)',marginBottom:16,display:'flex',gap:2,overflowX:'auto'}}>
        {tabBtn('overview','Overview')}
        {tabBtn('locations','Locations')}
        {tabBtn('roles','Roles')}
        {tabBtn('sales','Sales & Labour %')}
        {tabBtn('alerts','Alerts',alerts.length)}
        {tabBtn('top','Top Earners')}
      </div>

      {/* Alert drill-down modal */}
      {alertDetail && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setAlertDetail(null)}>
          <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.1)',borderRadius:14,width:'min(700px,95vw)',maxHeight:'80vh',overflowY:'auto',padding:20}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:600,fontSize:15,color:'#f9fafb'}}>{alertTitle}</div>
              <button onClick={()=>setAlertDetail(null)} style={{background:'transparent',border:'none',color:'#6b7280',fontSize:20,cursor:'pointer'}}>×</button>
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                {['Employee','Location','Role','Hours','Wage','Payroll','Cash'].map(h=>(
                  <th key={h} style={{padding:'7px 10px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {alertDetail.map((r,i)=>(
                  <tr key={i} style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                    <td style={{padding:'7px 10px',color:'#f9fafb'}}>{r.employee_name}</td>
                    <td style={{padding:'7px 10px',color:'#9ca3af',fontSize:11}}>{r.location}</td>
                    <td style={{padding:'7px 10px',color:'#9ca3af',fontSize:11}}>{r.role}</td>
                    <td style={{padding:'7px 10px',color:'#22d3ee',textAlign:'right'}}>{r.actual_hours.toFixed(1)}h</td>
                    <td style={{padding:'7px 10px',color:'#9ca3af',textAlign:'right'}}>${(r.wage||0).toFixed(2)}</td>
                    <td style={{padding:'7px 10px',color:'#34d399',textAlign:'right'}}>{cadFull(r.payroll_amount)}</td>
                    <td style={{padding:'7px 10px',color:'#fbbf24',textAlign:'right'}}>{r.cash_amount>0?cadFull(r.cash_amount):'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales entry modal */}
      {showSalesModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setShowSalesModal(false)}>
          <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.1)',borderRadius:14,width:'min(620px,95vw)',maxHeight:'85vh',overflowY:'auto',padding:22}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontWeight:600,fontSize:15,color:'#f9fafb'}}>Enter Daily Sales</div>
              <button onClick={()=>setShowSalesModal(false)} style={{background:'transparent',border:'none',color:'#6b7280',fontSize:20,cursor:'pointer'}}>×</button>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#6b7280',display:'block',marginBottom:4}}>Date</label>
              <input type="date" value={salesDate} onChange={e=>setSalesDate(e.target.value)} style={{...inp,width:160}}/>
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                {['Location','Net Sales ($)','Gross Sales ($)','Covers'].map(h=>(
                  <th key={h} style={{padding:'8px 10px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {LOCATIONS.map(loc=>(
                  <tr key={loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                    <td style={{padding:'8px 10px',color:'#f9fafb',fontSize:12}}>{loc}</td>
                    <td style={{padding:'6px 8px'}}><input type="number" placeholder="0" value={salesEntry[loc]?.net||''} onChange={e=>{const v=e.target.value;setSalesEntry(p=>({...p,[loc]:{net:v,gross:p[loc]?.gross||'',covers:p[loc]?.covers||''}}));}} style={{...inp,width:100}} /></td>
                    <td style={{padding:'6px 8px'}}><input type="number" placeholder="0" value={salesEntry[loc]?.gross||''} onChange={e=>{const v=e.target.value;setSalesEntry(p=>({...p,[loc]:{net:p[loc]?.net||'',gross:v,covers:p[loc]?.covers||''}}));}} style={{...inp,width:100}} /></td>
                    <td style={{padding:'6px 8px'}}><input type="number" placeholder="0" value={salesEntry[loc]?.covers||''} onChange={e=>{const v=e.target.value;setSalesEntry(p=>({...p,[loc]:{net:p[loc]?.net||'',gross:p[loc]?.gross||'',covers:v}}));}} style={{...inp,width:70}} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {salesMsg && <div style={{marginTop:12,fontSize:12,color:salesMsg.startsWith('✓')?'#34d399':'#f87171'}}>{salesMsg}</div>}
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button onClick={saveSales} disabled={savingSales} style={{background:'#22d3ee',color:'#0a0c10',border:'none',borderRadius:7,padding:'8px 20px',fontSize:13,fontWeight:600,cursor:savingSales?'wait':'pointer'}}>
                {savingSales?'Saving…':'Save Sales'}
              </button>
              <button onClick={()=>setShowSalesModal(false)} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:7,padding:'8px 16px',fontSize:13,cursor:'pointer'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div style={{color:'#6b7280',textAlign:'center',padding:60}}>Loading…</div> : (
        <>
          {/* OVERVIEW */}
          {tab==='overview' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
                <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>Monthly labour cost — {new Date(fromDate).getFullYear()}</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthly.filter(m=>m.payrollAmount>0)}>
                    <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/><YAxis tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                    <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                    <Bar dataKey="payrollAmount" fill="#a78bfa" radius={[4,4,0,0]} name="Payroll"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
                <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>Cost by department</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={byDept.slice(0,5)} dataKey="cost" nameKey="dept" cx="45%" cy="50%" outerRadius={75} label={({name,percent}:any)=>`${name} ${((percent||0)*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {byDept.slice(0,5).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16,gridColumn:'1/-1'}}>
                <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>Hours worked monthly trend</div>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={monthly.filter(m=>m.totalHours>0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/><YAxis tick={{fill:'#6b7280',fontSize:11}}/>
                    <Tooltip contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                    <Line type="monotone" dataKey="totalHours" stroke="#22d3ee" strokeWidth={2} dot={false} name="Hours"/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* LOCATIONS */}
          {tab==='locations' && (
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                  {['Location','Staff','Hours','Payroll','Cash','Total Cost','Cost/hr','Sales','Labour %'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {byLocation.map((l,i)=>{
                    const labPct = l.sales>0?l.cost/l.sales:null;
                    return (
                      <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                        <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{l.loc}</td>
                        <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.headcount}</td>
                        <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{l.hours.toFixed(1)}h</td>
                        <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{cad(l.payroll)}</td>
                        <td style={{padding:'9px 14px',color:'#fbbf24',textAlign:'right'}}>{cad(l.cash)}</td>
                        <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(l.cost)}</td>
                        <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${l.hours>0?(l.cost/l.hours).toFixed(2):0}</td>
                        <td style={{padding:'9px 14px',color:l.sales>0?'#f9fafb':'#4b5563',textAlign:'right'}}>{l.sales>0?cad(l.sales):'—'}</td>
                        <td style={{padding:'9px 14px',textAlign:'right'}}>
                          {labPct!=null?<span style={{fontWeight:600,color:labPct>0.35?'#f87171':labPct>0.25?'#fbbf24':'#34d399'}}>{(labPct*100).toFixed(1)}%</span>:<span style={{color:'#4b5563'}}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ROLES */}
          {tab==='roles' && (
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                  {['Role','Staff','Hours','Avg Wage','Total Cost','Cost/hr','% of Total'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {byRole.map((r,i)=>(
                    <tr key={r.role} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                      <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{r.role}</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{r.count}</td>
                      <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{r.hours.toFixed(1)}h</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${r.avgWage.toFixed(2)}</td>
                      <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(r.cost)}</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${r.hours>0?(r.cost/r.hours).toFixed(2):0}</td>
                      <td style={{padding:'9px 14px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
                          <div style={{width:50,height:5,background:'rgba(255,255,255,0.08)',borderRadius:3,overflow:'hidden'}}>
                            <div style={{width:`${Math.min(100,(r.cost/summary.totalCost)*100)}%`,height:'100%',background:'#a78bfa',borderRadius:3}}/>
                          </div>
                          <span style={{color:'#6b7280',minWidth:36,textAlign:'right'}}>{pct(r.cost,summary.totalCost)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* SALES & LABOUR % */}
          {tab==='sales' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:14}}>
                {[
                  {l:'Total Sales',v:totalSales>0?cad(totalSales):'No sales entered',c:'#34d399'},
                  {l:'Total Labour',v:cad(summary.totalCost),c:'#a78bfa'},
                  {l:'Labour %',v:totalSales>0?pct(summary.totalCost,totalSales):'—',c:totalSales>0&&summary.totalCost/totalSales>0.35?'#f87171':totalSales>0&&summary.totalCost/totalSales>0.25?'#fbbf24':'#34d399'},
                  {l:'Workers',v:summary.headcount,c:'#22d3ee'},
                  {l:'Sales per worker',v:totalSales>0&&summary.headcount>0?cad(totalSales/summary.headcount):'—',c:'#60a5fa'},
                  {l:'Labour per hour',v:`$${summary.hours>0?(summary.totalCost/summary.hours).toFixed(2):0}`,c:'#fbbf24'},
                ].map(k=>(
                  <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
                    <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>{k.l}</div>
                    <div style={{fontSize:17,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
                  </div>
                ))}
              </div>
              {totalSales === 0 && (
                <div style={{background:'rgba(251,191,36,0.08)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:'14px 18px',marginBottom:14,fontSize:13,color:'#fbbf24'}}>
                  No sales data for this period. Click <strong>+ Enter Sales</strong> above to add daily sales per location, then Labour % will be calculated automatically.
                </div>
              )}
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>
                  Per-location: workers, hours, wages vs sales
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                    {['Location','Workers','Hours','Total Wages','Sales','Labour %','Sales/Worker'].map(h=>(
                      <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {byLocation.map((l,i)=>{
                      const labPct = l.sales>0 ? l.cost/l.sales : null;
                      return (
                        <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                          <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{l.loc}</td>
                          <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{l.headcount}</td>
                          <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.hours.toFixed(1)}h</td>
                          <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:600,textAlign:'right'}}>{cad(l.cost)}</td>
                          <td style={{padding:'9px 14px',color:l.sales>0?'#34d399':'#4b5563',textAlign:'right'}}>{l.sales>0?cad(l.sales):<span>—</span>}</td>
                          <td style={{padding:'9px 14px',textAlign:'right'}}>
                            {labPct!=null
                              ?<span style={{fontWeight:700,color:labPct>0.35?'#f87171':labPct>0.25?'#fbbf24':'#34d399'}}>{(labPct*100).toFixed(1)}%</span>
                              :<span style={{color:'#4b5563'}}>—</span>}
                          </td>
                          <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.sales>0&&l.headcount>0?cad(l.sales/l.headcount):'—'}</td>
                        </tr>
                      );
                    })}
                    <tr style={{borderTop:'2px solid rgba(255,255,255,0.1)',background:'rgba(34,211,238,0.04)'}}>
                      <td style={{padding:'9px 14px',fontWeight:700,color:'#22d3ee'}}>TOTAL</td>
                      <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right',fontWeight:700}}>{summary.headcount}</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right',fontWeight:700}}>{summary.hours.toFixed(1)}h</td>
                      <td style={{padding:'9px 14px',color:'#a78bfa',textAlign:'right',fontWeight:700}}>{cad(summary.totalCost)}</td>
                      <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right',fontWeight:700}}>{totalSales>0?cad(totalSales):'—'}</td>
                      <td style={{padding:'9px 14px',textAlign:'right',fontWeight:700}}>
                        {totalSales>0?<span style={{color:summary.totalCost/totalSales>0.35?'#f87171':summary.totalCost/totalSales>0.25?'#fbbf24':'#34d399'}}>{pct(summary.totalCost,totalSales)}</span>:'—'}
                      </td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right',fontWeight:700}}>{totalSales>0&&summary.headcount>0?cad(totalSales/summary.headcount):'—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Sales history */}
              {sales.length > 0 && (
                <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',marginTop:14}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>Sales entries</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                      {['Date','Location','Net Sales','Gross Sales','Covers'].map(h=>(
                        <th key={h} style={{padding:'7px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {sales.slice(0,50).map((s,i)=>(
                        <tr key={i} style={{borderTop:'1px solid rgba(255,255,255,0.04)'}}>
                          <td style={{padding:'7px 14px',color:'#9ca3af'}}>{s.sale_date}</td>
                          <td style={{padding:'7px 14px',color:'#f9fafb'}}>{s.location}</td>
                          <td style={{padding:'7px 14px',color:'#34d399',textAlign:'right'}}>{cadFull(+s.net_sales)}</td>
                          <td style={{padding:'7px 14px',color:'#9ca3af',textAlign:'right'}}>{s.gross_sales>0?cadFull(+s.gross_sales):'—'}</td>
                          <td style={{padding:'7px 14px',color:'#9ca3af',textAlign:'right'}}>{s.covers||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ALERTS */}
          {tab==='alerts' && (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {alerts.length===0
                ? <div style={{color:'#34d399',textAlign:'center',padding:40,fontSize:14}}>✓ No issues detected for this period</div>
                : alerts.map((a,i)=>(
                  <div key={i} onClick={()=>{setAlertDetail(a.rows);setAlertTitle(a.type);}}
                    style={{background:'#131720',border:`1px solid ${a.sev==='high'?'rgba(248,113,113,0.3)':a.sev==='medium'?'rgba(251,191,36,0.3)':'rgba(34,211,238,0.2)'}`,borderRadius:12,padding:'14px 18px',display:'flex',gap:14,alignItems:'flex-start',cursor:'pointer',transition:'opacity 0.15s'}}
                    onMouseEnter={e=>(e.currentTarget.style.opacity='0.8')} onMouseLeave={e=>(e.currentTarget.style.opacity='1')}>
                    <span style={{fontSize:22,flexShrink:0}}>{a.sev==='high'?'🔴':a.sev==='medium'?'🟡':'🔵'}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13,color:a.sev==='high'?'#f87171':a.sev==='medium'?'#fbbf24':'#22d3ee',marginBottom:4}}>{a.type}</div>
                      <div style={{fontSize:12,color:'#9ca3af'}}>{a.msg}</div>
                      <div style={{fontSize:11,color:'#4b5563',marginTop:4}}>{a.rows?.slice(0,5).map((r:Row)=>r.employee_name).join(', ')}{a.rows?.length>5?` +${a.rows.length-5} more`:''}</div>
                    </div>
                    <span style={{fontSize:11,color:'#6b7280',whiteSpace:'nowrap',alignSelf:'center'}}>Click to view →</span>
                  </div>
                ))
              }
            </div>
          )}

          {/* TOP EARNERS */}
          {tab==='top' && (
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                  {['#','Employee','Location','Role','Hours','Wage','Payroll','Cash','Total'].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {topEarners.map((r,i)=>(
                    <tr key={r.employee_name} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                      <td style={{padding:'9px 14px',color:'#6b7280',fontWeight:600}}>#{i+1}</td>
                      <td style={{padding:'9px 14px',color:'#f9fafb',fontWeight:500}}>{r.employee_name}</td>
                      <td style={{padding:'9px 14px',color:'#6b7280',fontSize:11}}>{r.location}</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',fontSize:11}}>{r.role}</td>
                      <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{r.actual_hours.toFixed(1)}h</td>
                      <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${(r.wage||0).toFixed(2)}</td>
                      <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{cad(r.payroll_amount)}</td>
                      <td style={{padding:'9px 14px',color:'#fbbf24',textAlign:'right'}}>{r.cash_amount>0?cad(r.cash_amount):'—'}</td>
                      <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(r.payroll_amount+r.cash_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
