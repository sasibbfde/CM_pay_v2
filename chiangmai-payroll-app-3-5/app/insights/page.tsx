'use client';
import { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

type Row = {
  employee_name: string; location: string; department: string; role: string;
  actual_hours: number; payroll_hours: number; cash_hours: number;
  wage: number; payroll_amount: number; cash_amount: number; rule_applied: string;
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cad = (n: number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const pct = (n: number, d: number) => d ? `${((n/d)*100).toFixed(1)}%` : '—';
const sel: React.CSSProperties = { background:'#1a1f2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#e5e7eb', padding:'7px 12px', fontSize:13, outline:'none', cursor:'pointer' };
const COLORS = ['#22d3ee','#a78bfa','#34d399','#fbbf24','#f87171','#60a5fa','#fb923c'];

export default function InsightsPage() {
  const [rows, setRows]       = useState<Row[]>([]);
  const [monthly, setMonthly] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear]       = useState(new Date().getFullYear());
  const [month, setMonth]     = useState(new Date().getMonth() + 1);
  const [period, setPeriod]   = useState('month');
  const [tab, setTab]         = useState<'overview'|'locations'|'roles'|'alerts'|'top'>('overview');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/payroll?year=${year}&month=${month}&period=${period}`)
      .then(r => r.json())
      .then(d => { setRows(d.rows||[]); setMonthly(d.monthly||[]); })
      .finally(() => setLoading(false));
  }, [year, month, period]);

  // ── Computed analytics ─────────────────────────────────────────────────────
  const summary = useMemo(() => ({
    totalCost:    rows.reduce((s,r) => s + r.payroll_amount + r.cash_amount, 0),
    payrollCost:  rows.reduce((s,r) => s + r.payroll_amount, 0),
    cashCost:     rows.reduce((s,r) => s + r.cash_amount, 0),
    totalHours:   rows.reduce((s,r) => s + r.actual_hours, 0),
    headcount:    rows.length,
    avgHourly:    rows.length ? rows.reduce((s,r) => s + (r.wage||0), 0) / rows.filter(r=>r.wage>0).length : 0,
    zeroWage:     rows.filter(r => !r.wage || r.wage === 0),
    cashOnly:     rows.filter(r => r.rule_applied === 'CASH_ONLY'),
    held:         rows.filter(r => r.rule_applied === 'HOLD_PAYROLL'),
    overhours:    rows.filter(r => r.actual_hours > 48),
  }), [rows]);

  const byLocation = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of rows) {
      const l = r.location || 'Unknown';
      if (!map.has(l)) map.set(l, { loc: l, cost: 0, hours: 0, headcount: 0, cashCost: 0 });
      const e = map.get(l);
      e.cost      += r.payroll_amount + r.cash_amount;
      e.cashCost  += r.cash_amount;
      e.hours     += r.actual_hours;
      e.headcount += 1;
    }
    return [...map.values()].sort((a,b) => b.cost - a.cost);
  }, [rows]);

  const byRole = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of rows) {
      const k = r.role || 'Unknown';
      if (!map.has(k)) map.set(k, { role: k, cost: 0, hours: 0, count: 0, totalWage: 0 });
      const e = map.get(k);
      e.cost      += r.payroll_amount + r.cash_amount;
      e.hours     += r.actual_hours;
      e.count     += 1;
      e.totalWage += r.wage || 0;
    }
    return [...map.values()].map(r => ({ ...r, avgWage: r.count ? r.totalWage/r.count : 0 })).sort((a,b) => b.cost - a.cost);
  }, [rows]);

  const byDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.department?.trim() || 'Unknown';
      map.set(k, (map.get(k)||0) + r.payroll_amount + r.cash_amount);
    }
    return [...map.entries()].map(([dept,cost]) => ({ dept, cost })).sort((a,b) => b.cost - a.cost);
  }, [rows]);

  const topEarners = useMemo(() =>
    [...rows].sort((a,b) => (b.payroll_amount+b.cash_amount)-(a.payroll_amount+a.cash_amount)).slice(0,15)
  , [rows]);

  const alerts = useMemo(() => {
    const list: {type: string; severity: 'high'|'medium'|'low'; message: string; count?: number}[] = [];
    if (summary.zeroWage.length > 0)
      list.push({ type:'Missing Wage', severity:'high', message:`${summary.zeroWage.length} employees have $0 wage — payroll calculated as $0 for them`, count: summary.zeroWage.length });
    if (summary.overhours.length > 0)
      list.push({ type:'Overtime Risk', severity:'medium', message:`${summary.overhours.length} employees exceeded 48 hours this period`, count: summary.overhours.length });
    if (summary.cashCost > summary.totalCost * 0.15)
      list.push({ type:'High Cash %%', severity:'medium', message:`Cash payments are ${pct(summary.cashCost, summary.totalCost)} of total payroll — review cash-only employees` });
    if (summary.held.length > 0)
      list.push({ type:'Held Payroll', severity:'low', message:`${summary.held.length} employees have payroll on hold — verify work permits`, count: summary.held.length });
    const highHours = rows.filter(r => r.actual_hours > 60);
    if (highHours.length > 0)
      list.push({ type:'Excessive Hours', severity:'high', message:`${highHours.length} employees worked 60+ hours — verify or apply cap rules`, count: highHours.length });
    return list;
  }, [rows, summary]);

  const sevColor = { high:'#f87171', medium:'#fbbf24', low:'#22d3ee' };
  const tabStyle = (t: string): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
    color: tab===t ? '#f9fafb' : '#6b7280', background: 'transparent', border: 'none', borderBottom: tab===t ? '2px solid #22d3ee' : '2px solid transparent',
  });

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'24px 32px'}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'#f9fafb',margin:0}}>Management Insights</h1>
          <p style={{color:'#6b7280',fontSize:13,margin:'4px 0 0'}}>Cost analysis, labour efficiency, and budget intelligence</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <select value={year} onChange={e=>setYear(+e.target.value)} style={sel}>{[2025,2026].map(y=><option key={y}>{y}</option>)}</select>
          <select value={month} onChange={e=>setMonth(+e.target.value)} style={sel}>{MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select>
          <select value={period} onChange={e=>setPeriod(e.target.value)} style={sel}>
            <option value="1-15">1–15</option><option value="16-end">16–End</option><option value="month">Full month</option>
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:20}}>
        {[
          {l:'Total labour cost',v:cad(summary.totalCost),c:'#a78bfa'},
          {l:'Payroll (cheque)',v:cad(summary.payrollCost),c:'#34d399'},
          {l:'Cash payments',v:cad(summary.cashCost),c:'#fbbf24'},
          {l:'Total hours',v:`${summary.totalHours.toFixed(0)}h`,c:'#22d3ee'},
          {l:'Active staff',v:summary.headcount,c:'#60a5fa'},
          {l:'Avg hourly rate',v:`$${summary.avgHourly.toFixed(2)}`,c:'#f97316'},
          {l:'Cost per hour',v:`$${summary.totalHours>0?(summary.totalCost/summary.totalHours).toFixed(2):0}`,c:'#f87171'},
          {l:'Alerts',v:alerts.length,c:alerts.some(a=>a.severity==='high')?'#f87171':'#fbbf24'},
        ].map(k=>(
          <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',lineHeight:1.4}}>{k.l}</div>
            <div style={{fontSize:19,fontWeight:700,color:k.c,marginTop:3}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{borderBottom:'1px solid rgba(255,255,255,0.07)',marginBottom:20,display:'flex',gap:4}}>
        {(['overview','locations','roles','alerts','top'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={tabStyle(t)}>
            {t==='top'?'Top earners':t.charAt(0).toUpperCase()+t.slice(1)}
            {t==='alerts'&&alerts.length>0&&<span style={{marginLeft:6,background:alerts.some(a=>a.severity==='high')?'rgba(248,113,113,0.2)':'rgba(251,191,36,0.2)',color:alerts.some(a=>a.severity==='high')?'#f87171':'#fbbf24',borderRadius:10,padding:'1px 7px',fontSize:10}}>{alerts.length}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{color:'#6b7280',textAlign:'center',padding:60}}>Loading analytics…</div>
      ) : (
        <>
          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              {/* Monthly trend */}
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
                <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Monthly labour cost — {year}</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthly.filter(m=>m.payrollAmount>0)}>
                    <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/>
                    <YAxis tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                    <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                    <Bar dataKey="payrollAmount" fill="#a78bfa" radius={[4,4,0,0]} name="Payroll"/>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Department pie */}
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
                <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Cost by department</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={byDept.slice(0,6)} dataKey="cost" nameKey="dept" cx="40%" cy="50%" outerRadius={80} label={({name,percent}:any)=>`${name} ${((percent||0)*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {byDept.slice(0,6).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Hours trend */}
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16,gridColumn:'1/-1'}}>
                <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Hours worked — monthly trend</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={monthly.filter(m=>m.totalHours>0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/>
                    <YAxis tick={{fill:'#6b7280',fontSize:11}}/>
                    <Tooltip contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
                    <Line type="monotone" dataKey="totalHours" stroke="#22d3ee" strokeWidth={2} dot={false} name="Hours"/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── LOCATIONS ── */}
          {tab === 'locations' && (
            <div>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                    {['Location','Staff','Hours','Cost/hr','Payroll','Cash','Total cost','Cash %'].map(h=>(
                      <th key={h} style={{padding:'10px 16px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {byLocation.map((l,i)=>(
                      <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                        <td style={{padding:'10px 16px',fontWeight:600,color:'#f9fafb'}}>{l.loc}</td>
                        <td style={{padding:'10px 16px',color:'#9ca3af',textAlign:'right'}}>{l.headcount}</td>
                        <td style={{padding:'10px 16px',color:'#22d3ee',textAlign:'right'}}>{l.hours.toFixed(1)}h</td>
                        <td style={{padding:'10px 16px',color:'#9ca3af',textAlign:'right'}}>${l.hours>0?(l.cost/l.hours).toFixed(2):0}</td>
                        <td style={{padding:'10px 16px',color:'#34d399',textAlign:'right'}}>{cad(l.cost-l.cashCost)}</td>
                        <td style={{padding:'10px 16px',color:'#fbbf24',textAlign:'right'}}>{cad(l.cashCost)}</td>
                        <td style={{padding:'10px 16px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(l.cost)}</td>
                        <td style={{padding:'10px 16px',textAlign:'right'}}>
                          <span style={{color:l.cashCost/l.cost>0.3?'#f87171':l.cashCost/l.cost>0.15?'#fbbf24':'#34d399',fontWeight:600}}>
                            {pct(l.cashCost,l.cost)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ROLES ── */}
          {tab === 'roles' && (
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                  {['Role','Staff','Total hours','Avg wage','Total cost','Cost/hr','% of total'].map(h=>(
                    <th key={h} style={{padding:'10px 16px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {byRole.map((r,i)=>(
                    <tr key={r.role} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                      <td style={{padding:'10px 16px',fontWeight:600,color:'#f9fafb'}}>{r.role}</td>
                      <td style={{padding:'10px 16px',color:'#9ca3af',textAlign:'right'}}>{r.count}</td>
                      <td style={{padding:'10px 16px',color:'#22d3ee',textAlign:'right'}}>{r.hours.toFixed(1)}h</td>
                      <td style={{padding:'10px 16px',color:'#9ca3af',textAlign:'right'}}>${r.avgWage.toFixed(2)}</td>
                      <td style={{padding:'10px 16px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(r.cost)}</td>
                      <td style={{padding:'10px 16px',color:'#9ca3af',textAlign:'right'}}>${r.hours>0?(r.cost/r.hours).toFixed(2):0}</td>
                      <td style={{padding:'10px 16px',textAlign:'right'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
                          <div style={{width:60,height:6,background:'rgba(255,255,255,0.08)',borderRadius:3,overflow:'hidden'}}>
                            <div style={{width:`${Math.min(100,(r.cost/summary.totalCost)*100)}%`,height:'100%',background:'#a78bfa',borderRadius:3}}/>
                          </div>
                          <span style={{color:'#6b7280',minWidth:36}}>{pct(r.cost,summary.totalCost)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── ALERTS ── */}
          {tab === 'alerts' && (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {alerts.length === 0 ? (
                <div style={{color:'#34d399',textAlign:'center',padding:40}}>✓ No issues detected</div>
              ) : alerts.map((a,i)=>(
                <div key={i} style={{background:'#131720',border:`1px solid ${a.severity==='high'?'rgba(248,113,113,0.3)':a.severity==='medium'?'rgba(251,191,36,0.3)':'rgba(34,211,238,0.2)'}`,borderRadius:12,padding:'16px 20px',display:'flex',gap:16,alignItems:'flex-start'}}>
                  <span style={{fontSize:20,flexShrink:0}}>{a.severity==='high'?'🔴':a.severity==='medium'?'🟡':'🔵'}</span>
                  <div>
                    <div style={{fontWeight:600,fontSize:14,color:(sevColor as any)[a.severity],marginBottom:4}}>{a.type}</div>
                    <div style={{fontSize:13,color:'#9ca3af'}}>{a.message}</div>
                    {a.type==='Missing Wage' && (
                      <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>
                        Affected: {summary.zeroWage.slice(0,5).map(e=>e.employee_name).join(', ')}{summary.zeroWage.length>5?` + ${summary.zeroWage.length-5} more`:''}
                      </div>
                    )}
                    {a.type==='Overtime Risk' && (
                      <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>
                        {summary.overhours.map(e=>`${e.employee_name} (${e.actual_hours.toFixed(1)}h)`).slice(0,5).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── TOP EARNERS ── */}
          {tab === 'top' && (
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
                  {['#','Employee','Location','Role','Hours','Wage','Payroll','Cash','Total'].map(h=>(
                    <th key={h} style={{padding:'10px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {topEarners.map((r,i)=>(
                    <tr key={r.employee_name} style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                      <td style={{padding:'10px 14px',color:'#6b7280',fontWeight:600}}>#{i+1}</td>
                      <td style={{padding:'10px 14px',color:'#f9fafb',fontWeight:500}}>{r.employee_name}</td>
                      <td style={{padding:'10px 14px',color:'#6b7280',fontSize:12}}>{r.location}</td>
                      <td style={{padding:'10px 14px',color:'#9ca3af',fontSize:12}}>{r.role}</td>
                      <td style={{padding:'10px 14px',color:'#22d3ee',textAlign:'right'}}>{r.actual_hours.toFixed(1)}h</td>
                      <td style={{padding:'10px 14px',color:'#9ca3af',textAlign:'right'}}>${(r.wage||0).toFixed(2)}</td>
                      <td style={{padding:'10px 14px',color:'#34d399',textAlign:'right'}}>{cad(r.payroll_amount)}</td>
                      <td style={{padding:'10px 14px',color:'#fbbf24',textAlign:'right'}}>{r.cash_amount>0?cad(r.cash_amount):'—'}</td>
                      <td style={{padding:'10px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cad(r.payroll_amount+r.cash_amount)}</td>
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
