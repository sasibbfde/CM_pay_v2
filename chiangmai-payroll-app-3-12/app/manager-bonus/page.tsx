'use client';
import { useEffect, useMemo, useState } from 'react';

type ManagerRow = {
  employee_id:string; employee_name:string; location:string; department:string; role:string; worked_hours:number;
  original_bonus:number; attendance:number|null; inventory:number|null; cleaning:number|null; labour_control:number|null;
  customer_service_leadership:number|null; notes?:string; approval?:string; totalPoints:number; scorePercent:number;
  maxExtraBonus:number; earnedExtraBonus:number; finalBonus:number;
};

const categories = [
  ['Attendance','attendance'],['Inventory','inventory'],['Cleaning','cleaning'],['Labour Control','labour_control'],['Customer Service / Leadership','customer_service_leadership'],
] as const;
const currency = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'});
const inputStyle:React.CSSProperties={background:'#0d1117',border:'1px solid rgba(255,255,255,.12)',borderRadius:7,color:'#f9fafb',padding:'7px 10px',fontSize:12,outline:'none'};
const buttonStyle:React.CSSProperties={borderRadius:7,padding:'7px 12px',fontSize:12,cursor:'pointer',border:'1px solid rgba(34,211,238,.3)',background:'rgba(34,211,238,.1)',color:'#22d3ee'};

function periodDates(month:string,period:string){
  const [year,number]=month.split('-').map(Number); const last=new Date(year,number,0).getDate();
  return { start:`${month}-${period==='16-end'?'16':'01'}`, end:`${month}-${String(period==='1-15'?15:last).padStart(2,'0')}` };
}
function calculate(row:ManagerRow){
  const totalPoints=categories.reduce((sum,[,key])=>sum+(Number(row[key])||0),0); const scorePercent=totalPoints/25;
  const maxExtraBonus=Number(row.original_bonus||0)*.5; const earnedExtraBonus=maxExtraBonus*scorePercent;
  return {...row,totalPoints,scorePercent,maxExtraBonus,earnedExtraBonus,finalBonus:Number(row.original_bonus||0)+earnedExtraBonus};
}

function Rating({value,onChange}:{value:number|null;onChange:(value:number)=>void}){
  return <div aria-label={`Rating ${value ?? 'not set'} out of 5`} style={{display:'flex',alignItems:'center',gap:2}}>
    <button type="button" title="No mark" onClick={()=>onChange(0)} style={{border:0,background:'transparent',color:value===0?'#f87171':'#4b5563',fontSize:10,cursor:'pointer',padding:2}}>0</button>
    {[1,2,3,4,5].map(star=><button type="button" key={star} title={`${star} point${star===1?'':'s'}`} onClick={()=>onChange(star)} style={{border:0,background:'transparent',color:value!==null&&star<=value?'#fbbf24':'#374151',fontSize:18,lineHeight:1,cursor:'pointer',padding:1}}>★</button>)}
  </div>;
}

export default function ManagerBonusPage(){
  const now=new Date(); const [month,setMonth]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [period,setPeriod]=useState('month'); const [location,setLocation]=useState('ALL'); const [rows,setRows]=useState<ManagerRow[]>([]);
  const [loading,setLoading]=useState(true); const [message,setMessage]=useState(''); const [saving,setSaving]=useState('');
  const dates=useMemo(()=>periodDates(month,period),[month,period]);

  useEffect(()=>{let active=true;setLoading(true);setMessage('');fetch(`/api/manager-bonus?start=${dates.start}&end=${dates.end}`)
    .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load manager bonuses');if(active)setRows((data.rows||[]).map(calculate));})
    .catch(error=>active&&setMessage(error.message)).finally(()=>active&&setLoading(false));return()=>{active=false};},[dates.start,dates.end]);

  const locations=useMemo(()=>[...new Set(rows.map(row=>row.location))].sort(),[rows]);
  const visible=useMemo(()=>location==='ALL'?rows:rows.filter(row=>row.location===location),[rows,location]);
  const totals=useMemo(()=>visible.reduce((sum,row)=>({hours:sum.hours+row.worked_hours,original:sum.original+row.original_bonus,extra:sum.extra+row.earnedExtraBonus,final:sum.final+row.finalBonus}),{hours:0,original:0,extra:0,final:0}),[visible]);
  function update(indexKey:string,field:keyof ManagerRow,value:any){setRows(current=>current.map(row=>`${row.employee_id}\u0000${row.location}`===indexKey?calculate({...row,[field]:value}):row));}
  async function save(row:ManagerRow){const key=`${row.employee_id}\u0000${row.location}`;setSaving(key);setMessage('');try{const response=await fetch('/api/manager-bonus',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,period_start:dates.start,period_end:dates.end})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Save failed');setMessage(`Saved ${row.employee_name} — ${row.location}`);}catch(error:any){setMessage(error.message)}finally{setSaving('')}}
  function exportUrl(extra=''){return `/api/manager-bonus/export?start=${dates.start}&end=${dates.end}${extra}`;}

  return <main style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'24px 28px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:18}}><div><h1 style={{margin:0,fontSize:23,color:'#f9fafb'}}>Manager Bonus</h1><p style={{margin:'5px 0 0',fontSize:12,color:'#6b7280'}}>7shifts hours · five-category 0–5 review · 50% prorated bonus pool</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button style={buttonStyle} onClick={()=>window.location.href=exportUrl(location==='ALL'?'':`&location=${encodeURIComponent(location)}`)}>↓ Download {location==='ALL'?'all locations':location}</button></div></div>
    <section style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'12px 14px',background:'#131720',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,marginBottom:14}}>
      <label style={{fontSize:11,color:'#9ca3af'}}>Month <input type="month" value={month} onChange={event=>setMonth(event.target.value)} style={{...inputStyle,marginLeft:5}}/></label>
      <label style={{fontSize:11,color:'#9ca3af'}}>Payroll period <select value={period} onChange={event=>setPeriod(event.target.value)} style={{...inputStyle,marginLeft:5}}><option value="month">Full month</option><option value="1-15">1–15</option><option value="16-end">16–End</option></select></label>
      <label style={{fontSize:11,color:'#9ca3af'}}>Location <select value={location} onChange={event=>setLocation(event.target.value)} style={{...inputStyle,marginLeft:5}}><option value="ALL">All locations</option>{locations.map(item=><option key={item}>{item}</option>)}</select></label>
      <span style={{fontSize:11,color:'#6b7280',marginLeft:'auto'}}>{dates.start} → {dates.end}</span>
    </section>
    {message&&<div role="status" style={{fontSize:12,color:message.startsWith('Saved')?'#34d399':'#f87171',marginBottom:12}}>{message}</div>}
    <section style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(150px,1fr))',gap:8,marginBottom:14}}>{[['Manager hours',totals.hours.toFixed(1)],['Original bonus',currency.format(totals.original)],['Earned extra',currency.format(totals.extra)],['Final payout',currency.format(totals.final)]].map(([label,value])=><div key={label} style={{background:'#131720',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,padding:'12px 14px'}}><div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase'}}>{label}</div><div style={{fontSize:20,fontWeight:700,marginTop:4,color:'#f9fafb'}}>{value}</div></div>)}</section>
    {loading?<div style={{padding:40,textAlign:'center',color:'#6b7280'}}>Loading manager hours…</div>:visible.length===0?<div style={{padding:40,textAlign:'center',color:'#6b7280'}}>No managers found for this selection. Check manager roles in 7shifts and sync again.</div>:
      <div style={{display:'grid',gap:12}}>{visible.map(row=>{const key=`${row.employee_id}\u0000${row.location}`;return <article key={key} style={{background:'#131720',border:'1px solid rgba(255,255,255,.07)',borderRadius:11,overflow:'hidden'}}>
        <header style={{padding:'12px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',borderBottom:'1px solid rgba(255,255,255,.06)'}}><div><div style={{fontWeight:650,color:'#f9fafb'}}>{row.employee_name}</div><div style={{fontSize:10,color:'#6b7280',marginTop:2}}>{row.location} · {row.role||row.department||'Manager'} · {row.worked_hours.toFixed(2)} hours</div></div><div style={{display:'flex',gap:7}}><button style={buttonStyle} onClick={()=>window.location.href=exportUrl(`&employee_id=${encodeURIComponent(row.employee_id)}&location=${encodeURIComponent(row.location)}`)}>Download</button><button disabled={saving===key} onClick={()=>save(row)} style={{...buttonStyle,background:'rgba(52,211,153,.12)',borderColor:'rgba(52,211,153,.35)',color:'#34d399'}}>{saving===key?'Saving…':'Save review'}</button></div></header>
        <div style={{padding:14,display:'grid',gridTemplateColumns:'minmax(150px,.7fr) repeat(5,minmax(135px,1fr))',gap:10,alignItems:'end',overflowX:'auto'}}>
          <label style={{fontSize:10,color:'#9ca3af'}}>Original Bonus<input type="number" min="0" step="0.01" value={row.original_bonus} onChange={event=>update(key,'original_bonus',Number(event.target.value))} style={{...inputStyle,width:'100%',marginTop:5,boxSizing:'border-box'}}/></label>
          {categories.map(([label,field])=><div key={field}><div style={{fontSize:10,color:'#9ca3af',marginBottom:6,minHeight:24}}>{label}</div><Rating value={row[field]} onChange={value=>update(key,field,value)}/></div>)}
        </div>
        <div style={{padding:'0 14px 14px',display:'grid',gridTemplateColumns:'2fr 1fr repeat(4,minmax(100px,.7fr))',gap:9,alignItems:'end'}}>
          <label style={{fontSize:10,color:'#9ca3af'}}>Review notes<input value={row.notes||''} onChange={event=>update(key,'notes',event.target.value)} style={{...inputStyle,width:'100%',boxSizing:'border-box',marginTop:5}}/></label>
          <label style={{fontSize:10,color:'#9ca3af'}}>Approval<input value={row.approval||''} onChange={event=>update(key,'approval',event.target.value)} placeholder="Approved by" style={{...inputStyle,width:'100%',boxSizing:'border-box',marginTop:5}}/></label>
          {[['Points',`${row.totalPoints}/25`],['Score',`${(row.scorePercent*100).toFixed(0)}%`],['Extra',currency.format(row.earnedExtraBonus)],['Final',currency.format(row.finalBonus)]].map(([label,value])=><div key={label} style={{background:'#0d1117',borderRadius:7,padding:'8px 9px'}}><div style={{fontSize:9,color:'#6b7280'}}>{label}</div><div style={{fontSize:13,fontWeight:650,color:label==='Final'?'#34d399':'#e5e7eb',marginTop:3}}>{value}</div></div>)}
        </div>
      </article>})}</div>}
  </main>;
}
