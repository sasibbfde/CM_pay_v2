'use client';
import { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';

type PayrollRow = { employee_name:string; location:string; department:string; role:string;
  actual_hours:number; payroll_hours:number; cash_hours:number; wage:number;
  payroll_amount:number; cash_amount:number; rule_applied:string; };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cad = (n:number) => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const sel: React.CSSProperties = {background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer'};

export default function LabourPage() {
  const [rows, setRows]       = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear]       = useState(new Date().getFullYear());
  const [month, setMonth]     = useState(new Date().getMonth()+1);
  const [period, setPeriod]   = useState('month');
  const [monthly, setMonthly] = useState<any[]>([]);
  const [sales, setSales]     = useState<Record<string,number>>({});
  const [editSales, setEditSales] = useState(false);
  const [salesInput, setSalesInput] = useState<Record<string,string>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/payroll?year=${year}&month=${month}&period=${period}`)
      .then(r=>r.json())
      .then(d=>{ setRows(d.rows||[]); setMonthly(d.monthly||[]); })
      .finally(()=>setLoading(false));
  }, [year, month, period]);

  // Location aggregates
  const byLocation = useMemo(() => {
    const map = new Map<string, {hours:number; payroll:number; cash:number; headcount:Set<string>}>();
    for (const r of rows) {
      const loc = r.location||'Unknown';
      if (!map.has(loc)) map.set(loc, {hours:0, payroll:0, cash:0, headcount:new Set()});
      const e = map.get(loc)!;
      e.hours   += r.actual_hours;
      e.payroll += r.payroll_amount;
      e.cash    += r.cash_amount;
      e.headcount.add(r.employee_name);
    }
    return [...map.entries()].map(([loc, v]) => ({
      loc, hours:v.hours, payroll:v.payroll, cash:v.cash,
      total:v.payroll+v.cash, headcount:v.headcount.size,
      sales: sales[loc]||0,
      labourPct: sales[loc] ? ((v.payroll+v.cash)/sales[loc]*100) : null,
    })).sort((a,b)=>b.total-a.total);
  }, [rows, sales]);

  const grandTotal = useMemo(() => ({
    hours:   rows.reduce((s,r)=>s+r.actual_hours,0),
    payroll: rows.reduce((s,r)=>s+r.payroll_amount,0),
    cash:    rows.reduce((s,r)=>s+r.cash_amount,0),
    heads:   new Set(rows.map(r=>r.employee_name)).size,
  }), [rows]);

  // Role breakdown
  const byRole = useMemo(() => {
    const map = new Map<string,{hours:number;cost:number;count:number}>();
    for (const r of rows) {
      const k = r.role||r.department||'Unknown';
      if (!map.has(k)) map.set(k,{hours:0,cost:0,count:0});
      const e=map.get(k)!; e.hours+=r.actual_hours; e.cost+=r.payroll_amount+r.cash_amount; e.count++;
    }
    return [...map.entries()].map(([role,v])=>({role,...v})).sort((a,b)=>b.cost-a.cost).slice(0,10);
  }, [rows]);

  const saveSales = () => {
    const next = {...sales};
    for (const [k,v] of Object.entries(salesInput)) { const n=parseFloat(v); if (!isNaN(n)) next[k]=n; }
    setSales(next); setEditSales(false);
    localStorage.setItem?.('cm_sales', JSON.stringify(next));
  };

  useEffect(()=>{
    try { const s=localStorage.getItem?.('cm_sales'); if(s) setSales(JSON.parse(s)); } catch{}
  },[]);

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'#f9fafb',margin:0}}>Labour & Cost Monitor</h1>
          <p style={{color:'#6b7280',fontSize:13,margin:'4px 0 0'}}>Hours, wages, and labour cost by location</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <select value={year} onChange={e=>setYear(+e.target.value)} style={sel}>{[2024,2025,2026].map(y=><option key={y}>{y}</option>)}</select>
          <select value={month} onChange={e=>setMonth(+e.target.value)} style={sel}>{MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select>
          <select value={period} onChange={e=>setPeriod(e.target.value)} style={sel}>
            <option value="1-15">1 – 15</option><option value="16-end">16 – End</option><option value="month">Full Month</option>
          </select>
          <button onClick={()=>{setSalesInput(Object.fromEntries(byLocation.map(l=>[l.loc,String(l.sales||'')])));setEditSales(true);}}
            style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer'}}>
            Enter sales
          </button>
        </div>
      </div>

      {/* Sales entry modal */}
      {editSales && (
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontSize:14,fontWeight:600,color:'#f9fafb',marginBottom:12}}>Enter sales by location ({MONTHS[month-1]} {year})</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
            {byLocation.map(l=>(
              <div key={l.loc} style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:12,color:'#9ca3af',minWidth:160}}>{l.loc}</span>
                <span style={{color:'#6b7280'}}>$</span>
                <input type="number" placeholder="0" value={salesInput[l.loc]||''}
                  onChange={e=>setSalesInput(p=>({...p,[l.loc]:e.target.value}))}
                  style={{...sel,width:100,padding:'5px 8px'}}/>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={saveSales} style={{background:'#22d3ee',color:'#0a0c10',border:'none',borderRadius:7,padding:'7px 20px',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save</button>
            <button onClick={()=>setEditSales(false)} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:24}}>
        {[
          {label:'Total hours',val:`${grandTotal.hours.toFixed(1)}h`,c:'#22d3ee'},
          {label:'Payroll cost',val:cad(grandTotal.payroll),c:'#34d399'},
          {label:'Cash cost',val:cad(grandTotal.cash),c:'#fbbf24'},
          {label:'Total labour',val:cad(grandTotal.payroll+grandTotal.cash),c:'#a78bfa'},
          {label:'Active staff',val:grandTotal.heads,c:'#60a5fa'},
          {label:'Cost/hr avg',val:`$${grandTotal.hours>0?((grandTotal.payroll+grandTotal.cash)/grandTotal.hours).toFixed(2):0}`,c:'#f87171'},
        ].map(k=>(
          <div key={k.label} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
            <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em'}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
        {/* Location cost chart */}
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:12,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Labour cost by location</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byLocation.slice(0,8)} layout="vertical" margin={{left:80,right:20}}>
              <XAxis type="number" tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="loc" tick={{fill:'#9ca3af',fontSize:11}} width={100}/>
              <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="payroll" name="Payroll" fill="#34d399" radius={[0,4,4,0]}/>
              <Bar dataKey="cash"    name="Cash"    fill="#fbbf24" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Role cost chart */}
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:12,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Cost by role (top 10)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byRole} layout="vertical" margin={{left:80,right:20}}>
              <XAxis type="number" tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="role" tick={{fill:'#9ca3af',fontSize:11}} width={100}/>
              <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="cost" name="Cost" fill="#a78bfa" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Location detail table */}
      <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',marginBottom:20}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>
          Location breakdown
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
            {['Location','Staff','Hours','Payroll $','Cash $','Total cost','Cost/hr','Sales','Labour %'].map(h=>(
              <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byLocation.map((l,i)=>(
              <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                <td style={{padding:'9px 14px',color:'#f9fafb',fontWeight:500}}>{l.loc}</td>
                <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.headcount}</td>
                <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{l.hours.toFixed(1)}h</td>
                <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{cad(l.payroll)}</td>
                <td style={{padding:'9px 14px',color:'#fbbf24',textAlign:'right'}}>{cad(l.cash)}</td>
                <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:600,textAlign:'right'}}>{cad(l.total)}</td>
                <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${l.hours>0?(l.total/l.hours).toFixed(2):0}</td>
                <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.sales>0?cad(l.sales):<span style={{color:'#4b5563'}}>—</span>}</td>
                <td style={{padding:'9px 14px',textAlign:'right'}}>
                  {l.labourPct!==null
                    ? <span style={{color:l.labourPct>35?'#f87171':l.labourPct>25?'#fbbf24':'#34d399',fontWeight:600}}>{l.labourPct.toFixed(1)}%</span>
                    : <span style={{color:'#4b5563'}}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monthly trend */}
      {monthly.length > 0 && (
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16}}>
          <div style={{fontSize:12,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Monthly labour trend — {year}</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="month" tick={{fill:'#6b7280',fontSize:11}}/>
              <YAxis tick={{fill:'#6b7280',fontSize:11}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={(v:any)=>cad(Number(v))} contentStyle={{background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:12}}/>
              <Line type="monotone" dataKey="payrollAmount" stroke="#34d399" strokeWidth={2} dot={false} name="Payroll"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
