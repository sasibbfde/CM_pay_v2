'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,CartesianGrid } from 'recharts';
import { cachedJson, peekJson } from '@/lib/client-cache';

type PayrollRow = { employee_name:string; location:string; department:string; role:string;
  actual_hours:number; payroll_hours:number; cash_hours:number;
  wage:number; payroll_amount:number; cash_amount:number; rule_applied:string; };

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cad=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n||0);
const cadFull=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n||0);
const sel:React.CSSProperties={background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer'};
const inp:React.CSSProperties={background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:6,color:'#f9fafb',padding:'6px 10px',fontSize:13,outline:'none'};
function isoDate(d:Date){return d.toISOString().split('T')[0];}

export default function LabourPage() {
  const today=new Date();
  const [preset,setPreset]=useState('month');
  const [fromDate,setFromDate]=useState(isoDate(new Date(today.getFullYear(),today.getMonth(),1)));
  const [toDate,setToDate]=useState(isoDate(new Date(today.getFullYear(),today.getMonth()+1,0)));
  const initialUrl=`/api/payroll?year=${today.getFullYear()}&month=${today.getMonth()+1}&period=month&from=${fromDate}&to=${toDate}&include_trends=true`;
  const initial=peekJson<{rows:PayrollRow[];monthly:any[]}>(initialUrl);
  const [rows,setRows]=useState<PayrollRow[]>(()=>initial?.rows||[]);
  const [monthly,setMonthly]=useState<any[]>(()=>initial?.monthly||[]);
  const [loading,setLoading]=useState(()=>!initial);
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
    const url=`/api/payroll?year=${year}&month=${month}&period=month&from=${fromDate}&to=${toDate}&include_trends=true`;
    const cached=peekJson<{rows:PayrollRow[];monthly:any[]}>(url);
    if(cached){setRows(cached.rows||[]);setMonthly(cached.monthly||[]);}
    setLoading(!cached);
    cachedJson<{rows:PayrollRow[];monthly:any[]}>(url)
      .then(d=>{setRows(d.rows||[]);setMonthly(d.monthly||[]);}).finally(()=>setLoading(false));
  },[fromDate,toDate]);

  const byLocation=useMemo(()=>{
    const map=new Map<string,any>();
    for(const r of rows){
      const l=r.location||'Unknown';
      if(!map.has(l))map.set(l,{loc:l,hours:0,payroll:0,cash:0,headcount:0});
      const e=map.get(l);e.hours+=r.actual_hours;e.payroll+=r.payroll_amount;e.cash+=r.cash_amount;e.headcount++;
    }
    return [...map.values()].sort((a,b)=>b.payroll+b.cash-a.payroll-a.cash);
  },[rows]);

  const byRole=useMemo(()=>{
    const map=new Map<string,any>();
    for(const r of rows){
      const k=r.role||'Unknown';
      if(!map.has(k))map.set(k,{role:k,hours:0,cost:0,count:0});
      const e=map.get(k);e.hours+=r.actual_hours;e.cost+=r.payroll_amount+r.cash_amount;e.count++;
    }
    return [...map.values()].sort((a,b)=>b.cost-a.cost).slice(0,10);
  },[rows]);

  const grand={
    hours:rows.reduce((s,r)=>s+r.actual_hours,0),
    payroll:rows.reduce((s,r)=>s+r.payroll_amount,0),
    cash:rows.reduce((s,r)=>s+r.cash_amount,0),
    heads:rows.length,
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
          <button onClick={()=>window.location.href=`/api/export?from=${fromDate}&to=${toDate}&type=full`} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer'}}>↓ Export Excel</button>
          <button onClick={()=>{setSalesInput(Object.fromEntries(byLocation.map(l=>[l.loc,String(sales[l.loc]||'')])));setEditSales(true);}} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer'}}>Enter sales</button>
        </div>
      </div>

      {/* Date presets */}
      <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
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
          {l:'Total hours',v:`${grand.hours.toFixed(1)}h`,c:'#22d3ee'},
          {l:'Payroll cost',v:cad(grand.payroll),c:'#34d399'},
          {l:'Cash cost',v:cad(grand.cash),c:'#fbbf24'},
          {l:'Total labour',v:cad(grand.payroll+grand.cash),c:'#a78bfa'},
          {l:'Active staff',v:grand.heads,c:'#60a5fa'},
          {l:'Cost/hr avg',v:`$${grand.hours>0?((grand.payroll+grand.cash)/grand.hours).toFixed(2):0}`,c:'#f87171'},
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
            {['Location','Staff','Hours','Payroll $','Cash $','Total cost','Cost/hr','Sales','Labour %'].map(h=>(
              <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byLocation.map((l,i)=>{
              const total=l.payroll+l.cash;
              const sale=sales[l.loc]||0;
              const labPct=sale>0?total/sale:null;
              return(
                <tr key={l.loc} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                  <td style={{padding:'9px 14px',fontWeight:600,color:'#f9fafb'}}>{l.loc}</td>
                  <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>{l.headcount}</td>
                  <td style={{padding:'9px 14px',color:'#22d3ee',textAlign:'right'}}>{l.hours.toFixed(1)}h</td>
                  <td style={{padding:'9px 14px',color:'#34d399',textAlign:'right'}}>{cadFull(l.payroll)}</td>
                  <td style={{padding:'9px 14px',color:'#fbbf24',textAlign:'right'}}>{cadFull(l.cash)}</td>
                  <td style={{padding:'9px 14px',color:'#a78bfa',fontWeight:700,textAlign:'right'}}>{cadFull(total)}</td>
                  <td style={{padding:'9px 14px',color:'#9ca3af',textAlign:'right'}}>${l.hours>0?(total/l.hours).toFixed(2):0}</td>
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
