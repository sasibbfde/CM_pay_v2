'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';

type DaySales = {
  sale_date: string; location: string;
  net_sales: number; gross_sales: number; projected_sales: number;
  actual_labor_cost: number; labor_percent: number | null;
  sales_per_labor_hr: number | null; source: string;
};
type Punch = { location: string; clocked_in: string; hours: number; wage: number; };

const LOCATIONS = [
  'Chiang Mai Mississauga','Chiang Mai York Mills','Chiang Mai Parklawn',
  'Chiang Mai Liberty Village','Chiang Mai Junction','Chiang Mai Danforth','Imm Thai Kitchen'
];
const LOC_SHORT: Record<string,string> = {
  'Chiang Mai Mississauga':'Mississauga','Chiang Mai York Mills':'York Mills',
  'Chiang Mai Parklawn':'Parklawn','Chiang Mai Liberty Village':'Liberty',
  'Chiang Mai Junction':'Junction','Chiang Mai Danforth':'Danforth','Imm Thai Kitchen':'Imm Thai'
};

const cad = (n: number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const pct = (n: number) => `${(n*100).toFixed(1)}%`;
function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
function addDays(d: Date, n: number) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }

function getWeekDates(anchor: Date) {
  const mon = new Date(anchor);
  mon.setDate(anchor.getDate() - ((anchor.getDay()+6)%7));
  return Array.from({length:7}, (_,i) => addDays(mon, i));
}

export default function BudgetPage() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [sales, setSales]       = useState<DaySales[]>([]);
  const [punches, setPunches]   = useState<Punch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [syncMsg, setSyncMsg]   = useState('');
  const [locFilter, setLocFilter] = useState('ALL');

  const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor]);
  const fromDate  = isoDate(weekDates[0]);
  const toDate    = isoDate(weekDates[6]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [salesRes, payRes] = await Promise.all([
      fetch(`/api/sales?from=${fromDate}&to=${toDate}`).then(r=>r.json()),
      fetch(`/api/payroll?from=${fromDate}&to=${toDate}&year=${weekDates[0].getFullYear()}&month=${weekDates[0].getMonth()+1}&period=month`).then(r=>r.json()),
    ]);
    setSales(salesRes.sales || []);
    // Extract punches from payroll rows for daily breakdown
    setPunches([]);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const syncSales = async () => {
    setSyncing(true); setSyncMsg('');
    const res = await fetch('/api/sales-sync', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ start_date: fromDate, end_date: toDate }),
    });
    const d = await res.json();
    if (d.ok) {
      setSyncMsg(`✓ Synced ${d.synced} days from Snappy`);
      loadData();
    } else {
      setSyncMsg(`✗ ${d.error}`);
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(''), 5000);
  };

  // Build day-location matrix
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, DaySales>> = {};
    for (const s of sales) {
      if (!m[s.location]) m[s.location] = {};
      m[s.location][s.sale_date] = s;
    }
    return m;
  }, [sales]);

  // Daily totals across all locations
  const dailyTotals = useMemo(() => weekDates.map(d => {
    const date = isoDate(d);
    const rows = locFilter === 'ALL'
      ? sales.filter(s => s.sale_date === date)
      : sales.filter(s => s.sale_date === date && s.location === locFilter);
    return {
      date,
      actual_sales:    rows.reduce((s,r) => s + (r.net_sales||0), 0),
      proj_sales:      rows.reduce((s,r) => s + (r.projected_sales||0), 0),
      actual_labor:    rows.reduce((s,r) => s + (r.actual_labor_cost||0), 0),
      has_data:        rows.length > 0,
    };
  }), [sales, weekDates, locFilter]);

  const weekTotal = useMemo(() => ({
    actual_sales: dailyTotals.reduce((s,d) => s + d.actual_sales, 0),
    proj_sales:   dailyTotals.reduce((s,d) => s + d.proj_sales, 0),
    actual_labor: dailyTotals.reduce((s,d) => s + d.actual_labor, 0),
  }), [dailyTotals]);

  const weekLabourPct = weekTotal.actual_sales > 0 ? weekTotal.actual_labor / weekTotal.actual_sales : null;
  const noData = sales.length === 0;

  const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = isoDate(new Date());

  const filteredLocs = locFilter === 'ALL' ? LOCATIONS : [locFilter];

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'20px 24px'}}>

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:20,fontWeight:700,color:'#f9fafb',margin:0}}>Budget Tool</h1>
          <p style={{color:'#6b7280',fontSize:12,margin:'4px 0 0'}}>
            Actual sales from Snappy POS · Labour cost from 7shifts punches · Weekly view
          </p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {syncMsg && (
            <span style={{fontSize:11,color:syncMsg.startsWith('✓')?'#34d399':'#f87171',background:syncMsg.startsWith('✓')?'rgba(52,211,153,0.1)':'rgba(248,113,113,0.1)',padding:'4px 10px',borderRadius:5}}>
              {syncMsg}
            </span>
          )}
          <select value={locFilter} onChange={e=>setLocFilter(e.target.value)}
            style={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'6px 10px',fontSize:12,outline:'none'}}>
            <option value="ALL">All locations</option>
            {LOCATIONS.map(l=><option key={l}>{l}</option>)}
          </select>
          <button onClick={syncSales} disabled={syncing} style={{
            background:'rgba(52,211,153,0.12)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',
            borderRadius:7,padding:'6px 14px',fontSize:12,fontWeight:500,cursor:syncing?'wait':'pointer'
          }}>
            {syncing ? 'Syncing Snappy…' : '↻ Pull Sales from Snappy'}
          </button>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            <button onClick={()=>setWeekAnchor(addDays(weekAnchor,-7))} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:6,padding:'6px 10px',cursor:'pointer',fontSize:13}}>←</button>
            <button onClick={()=>setWeekAnchor(new Date())} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.2)',color:'#22d3ee',borderRadius:6,padding:'6px 12px',cursor:'pointer',fontSize:12}}>This week</button>
            <button onClick={()=>setWeekAnchor(addDays(weekAnchor,7))} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:6,padding:'6px 10px',cursor:'pointer',fontSize:13}}>→</button>
          </div>
        </div>
      </div>

      {/* Week KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:20}}>
        {[
          {l:'Week Sales',v:weekTotal.actual_sales>0?cad(weekTotal.actual_sales):'Sync needed',c:weekTotal.actual_sales>0?'#34d399':'#4b5563'},
          {l:'Projected Sales',v:weekTotal.proj_sales>0?cad(weekTotal.proj_sales):'—',c:'#9ca3af'},
          {l:'Week Labour',v:weekTotal.actual_labor>0?cad(weekTotal.actual_labor):'—',c:'#a78bfa'},
          {l:'Labour %',v:weekLabourPct!=null?pct(weekLabourPct):'—',c:weekLabourPct!=null&&weekLabourPct>0.35?'#f87171':weekLabourPct!=null&&weekLabourPct>0.25?'#fbbf24':'#34d399'},
          {l:'SPLH',v:weekTotal.actual_sales>0&&weekTotal.actual_labor>0?cad(weekTotal.actual_sales/(weekTotal.actual_labor/(18))):'—',c:'#60a5fa'},
        ].map(k=>(
          <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>{k.l}</div>
            <div style={{fontSize:17,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Daily columns — Budget Tool view */}
      <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',marginBottom:20}}>

        {/* Day headers */}
        <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <div style={{padding:'10px 14px',fontSize:11,color:'#6b7280',fontWeight:500}}>{fromDate} – {toDate}</div>
          {weekDates.map((d,i)=>{
            const isToday = isoDate(d) === today;
            const dt = dailyTotals[i];
            const lp = dt.actual_sales>0&&dt.actual_labor>0 ? dt.actual_labor/dt.actual_sales : null;
            return (
              <div key={i} style={{padding:'8px 6px',textAlign:'center',background:isToday?'rgba(34,211,238,0.06)':'transparent',borderLeft:'1px solid rgba(255,255,255,0.05)'}}>
                <div style={{fontSize:11,fontWeight:600,color:isToday?'#22d3ee':'#9ca3af'}}>{DAY_NAMES[i]}</div>
                <div style={{fontSize:10,color:'#6b7280'}}>{d.getMonth()+1}/{d.getDate()}</div>
                {lp!=null&&(
                  <div style={{fontSize:11,fontWeight:700,marginTop:2,color:lp>0.35?'#f87171':lp>0.25?'#fbbf24':'#34d399'}}>
                    {pct(lp)}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{padding:'10px 8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.07)',fontSize:11,color:'#6b7280',fontWeight:500}}>Week</div>
        </div>

        {/* Actual Sales row */}
        <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'rgba(52,211,153,0.03)'}}>
          <div style={{padding:'10px 14px',fontSize:12,fontWeight:600,color:'#34d399',display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#34d399',display:'inline-block'}}/>
            Actual Sales
          </div>
          {dailyTotals.map((d,i)=>(
            <div key={i} style={{padding:'10px 6px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.04)',fontSize:12}}>
              {d.actual_sales>0
                ? <span style={{color:'#34d399',fontWeight:600}}>{cad(d.actual_sales)}</span>
                : <span style={{color:'#374151'}}>—</span>}
            </div>
          ))}
          <div style={{padding:'10px 8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.07)',fontSize:12,fontWeight:700,color:'#34d399'}}>
            {weekTotal.actual_sales>0?cad(weekTotal.actual_sales):'—'}
          </div>
        </div>

        {/* Projected Sales row */}
        <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
          <div style={{padding:'10px 14px',fontSize:12,color:'#6b7280',display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#6b7280',display:'inline-block'}}/>
            Projected Sales
          </div>
          {dailyTotals.map((d,i)=>(
            <div key={i} style={{padding:'10px 6px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.04)',fontSize:12,color:'#6b7280'}}>
              {d.proj_sales>0?cad(d.proj_sales):'—'}
            </div>
          ))}
          <div style={{padding:'10px 8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.07)',fontSize:12,color:'#6b7280'}}>
            {weekTotal.proj_sales>0?cad(weekTotal.proj_sales):'—'}
          </div>
        </div>

        {/* Actual Labour row */}
        <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'rgba(167,139,250,0.03)'}}>
          <div style={{padding:'10px 14px',fontSize:12,fontWeight:600,color:'#a78bfa',display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#a78bfa',display:'inline-block'}}/>
            Actual Labour
          </div>
          {dailyTotals.map((d,i)=>(
            <div key={i} style={{padding:'10px 6px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.04)',fontSize:12}}>
              {d.actual_labor>0
                ? <span style={{color:'#a78bfa',fontWeight:600}}>{cad(d.actual_labor)}</span>
                : <span style={{color:'#374151'}}>—</span>}
            </div>
          ))}
          <div style={{padding:'10px 8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.07)',fontSize:12,fontWeight:700,color:'#a78bfa'}}>
            {weekTotal.actual_labor>0?cad(weekTotal.actual_labor):'—'}
          </div>
        </div>

        {/* Labour % row */}
        <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <div style={{padding:'10px 14px',fontSize:12,color:'#fbbf24',display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#fbbf24',display:'inline-block'}}/>
            Labour %
          </div>
          {dailyTotals.map((d,i)=>{
            const lp = d.actual_sales>0&&d.actual_labor>0 ? d.actual_labor/d.actual_sales : null;
            return (
              <div key={i} style={{padding:'10px 6px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.04)'}}>
                {lp!=null
                  ? <span style={{fontSize:12,fontWeight:700,color:lp>0.35?'#f87171':lp>0.25?'#fbbf24':'#34d399',background:lp>0.35?'rgba(248,113,113,0.1)':lp>0.25?'rgba(251,191,36,0.1)':'rgba(52,211,153,0.1)',padding:'2px 7px',borderRadius:4}}>{pct(lp)}</span>
                  : <span style={{color:'#374151',fontSize:12}}>—</span>
                }
              </div>
            );
          })}
          <div style={{padding:'10px 8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.07)'}}>
            {weekLabourPct!=null
              ? <span style={{fontSize:12,fontWeight:700,color:weekLabourPct>0.35?'#f87171':weekLabourPct>0.25?'#fbbf24':'#34d399'}}>{pct(weekLabourPct)}</span>
              : <span style={{color:'#374151',fontSize:12}}>—</span>
            }
          </div>
        </div>

        {/* Per-location breakdown */}
        {filteredLocs.map((loc, li) => {
          const locData = matrix[loc] || {};
          const locWeekSales  = weekDates.reduce((s,d) => s + (locData[isoDate(d)]?.net_sales||0), 0);
          const locWeekLabor  = weekDates.reduce((s,d) => s + (locData[isoDate(d)]?.actual_labor_cost||0), 0);
          const locWeekPct    = locWeekSales>0&&locWeekLabor>0 ? locWeekLabor/locWeekSales : null;
          return (
            <div key={loc} style={{borderTop:'1px solid rgba(255,255,255,0.04)',background:li%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
              {/* Location name row */}
              <div style={{display:'grid',gridTemplateColumns:'140px repeat(7, 1fr) 120px'}}>
                <div style={{padding:'8px 14px',fontSize:11,fontWeight:600,color:'#9ca3af'}}>{LOC_SHORT[loc]||loc}</div>
                {weekDates.map((d,i)=>{
                  const day = locData[isoDate(d)];
                  const lp = day?.net_sales>0&&day?.actual_labor_cost>0 ? day.actual_labor_cost/day.net_sales : null;
                  return (
                    <div key={i} style={{padding:'8px 6px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.03)'}}>
                      {day?.net_sales>0?(
                        <div>
                          <div style={{fontSize:11,color:'#34d399'}}>{cad(day.net_sales)}</div>
                          {day.actual_labor_cost>0&&<div style={{fontSize:10,color:'#a78bfa'}}>{cad(day.actual_labor_cost)}</div>}
                          {lp!=null&&<div style={{fontSize:10,fontWeight:600,color:lp>0.35?'#f87171':lp>0.25?'#fbbf24':'#34d399'}}>{pct(lp)}</div>}
                        </div>
                      ):<span style={{color:'#1f2937',fontSize:11}}>—</span>}
                    </div>
                  );
                })}
                <div style={{padding:'8px',textAlign:'center',borderLeft:'1px solid rgba(255,255,255,0.06)'}}>
                  {locWeekSales>0&&(
                    <div>
                      <div style={{fontSize:11,color:'#34d399',fontWeight:600}}>{cad(locWeekSales)}</div>
                      {locWeekPct!=null&&<div style={{fontSize:10,fontWeight:700,color:locWeekPct>0.35?'#f87171':locWeekPct>0.25?'#fbbf24':'#34d399'}}>{pct(locWeekPct)}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* No data help */}
      {noData && !loading && (
        <div style={{background:'rgba(251,191,36,0.06)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:'16px 20px',fontSize:13,color:'#fbbf24'}}>
          <strong>No sales data found for this week.</strong> Click <strong>↻ Pull Sales from Snappy</strong> above to fetch actual sales from 7shifts (powered by your Snappy POS integration). Data updates in real-time once connected.
        </div>
      )}

      {/* Sales per location table */}
      {!noData && (
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>
            Location detail — {fromDate} to {toDate}
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
              {['Location','Actual Sales','Proj. Sales','vs Proj','Labour Cost','Labour %','SPLH'].map(h=>(
                <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filteredLocs.map((loc,i) => {
                const locData = matrix[loc]||{};
                const sales_  = weekDates.reduce((s,d)=>s+(locData[isoDate(d)]?.net_sales||0),0);
                const proj    = weekDates.reduce((s,d)=>s+(locData[isoDate(d)]?.projected_sales||0),0);
                const labor   = weekDates.reduce((s,d)=>s+(locData[isoDate(d)]?.actual_labor_cost||0),0);
                const lp      = sales_>0&&labor>0 ? labor/sales_ : null;
                const vs_proj = sales_>0&&proj>0 ? (sales_-proj)/proj : null;
                const splh_est = sales_>0&&labor>0 ? sales_/(labor/18) : null; // rough
                return (
                  <tr key={loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                    <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{loc}</td>
                    <td style={{padding:'9px 14px',color:'#34d399',fontWeight:600,textAlign:'right'}}>{sales_>0?cad(sales_):'—'}</td>
                    <td style={{padding:'9px 14px',color:'#6b7280',textAlign:'right'}}>{proj>0?cad(proj):'—'}</td>
                    <td style={{padding:'9px 14px',textAlign:'right'}}>
                      {vs_proj!=null&&<span style={{color:vs_proj>=0?'#34d399':'#f87171',fontWeight:600}}>{vs_proj>=0?'+':''}{pct(vs_proj)}</span>}
                    </td>
                    <td style={{padding:'9px 14px',color:'#a78bfa',textAlign:'right'}}>{labor>0?cad(labor):'—'}</td>
                    <td style={{padding:'9px 14px',textAlign:'right'}}>
                      {lp!=null?<span style={{fontWeight:700,color:lp>0.35?'#f87171':lp>0.25?'#fbbf24':'#34d399'}}>{pct(lp)}</span>:'—'}
                    </td>
                    <td style={{padding:'9px 14px',color:'#6b7280',textAlign:'right'}}>{splh_est!=null?cad(splh_est):'—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
