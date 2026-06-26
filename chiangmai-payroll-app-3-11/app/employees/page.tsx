'use client';
import { useEffect, useState, useMemo } from 'react';

type Employee = {
  id: string; seven_shifts_user_id: string; full_name: string;
  location: string; department: string; role: string;
  wage: number; cash_wage: number; active: boolean;
};
type Punch = {
  punch_id: string; location: string; department: string; role: string;
  clocked_in: string; clocked_out: string | null;
  hours: number; payroll_hours: number; gross_hours: number; break_minutes: number; wage: number;
};

const sel: React.CSSProperties = { background:'#1a1f2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#e5e7eb', padding:'7px 10px', fontSize:12, outline:'none', cursor:'pointer' };
const inp: React.CSSProperties = { background:'#0d1117', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, color:'#f9fafb', padding:'5px 8px', fontSize:12, outline:'none' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-CA',{month:'short',day:'numeric',weekday:'short'}); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:true}); }
function isoDate(d: Date) { return d.toISOString().split('T')[0]; }
function cad(n: number) { return `$${n.toFixed(2)}`; }

export default function EmployeesPage() {
  const today = new Date();
  const [employees, setEmployees]  = useState<Employee[]>([]);
  const [selected,  setSelected]   = useState<Employee | null>(null);
  const [punches,   setPunches]    = useState<Punch[]>([]);
  const [loading,   setLoading]    = useState(true);
  const [punchLoad, setPunchLoad]  = useState(false);
  const [search,    setSearch]     = useState('');
  const [locFilter, setLocFilter]  = useState('ALL');
  const [showInactive, setShowInactive] = useState(false);
  // Date range — default to current month
  const [fromDate, setFromDate] = useState(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`);
  const [toDate,   setToDate]   = useState(isoDate(new Date(today.getFullYear(), today.getMonth()+1, 0)));
  const [preset,   setPreset]   = useState('month');

  const applyPreset = (p: string) => {
    setPreset(p);
    const y=today.getFullYear(), m=today.getMonth();
    if (p==='month')      { setFromDate(`${y}-${String(m+1).padStart(2,'0')}-01`); setToDate(isoDate(new Date(y,m+1,0))); }
    if (p==='1-15')       { setFromDate(`${y}-${String(m+1).padStart(2,'0')}-01`); setToDate(`${y}-${String(m+1).padStart(2,'0')}-15`); }
    if (p==='16-end')     { setFromDate(`${y}-${String(m+1).padStart(2,'0')}-16`); setToDate(isoDate(new Date(y,m+1,0))); }
    if (p==='last-month') { setFromDate(isoDate(new Date(y,m-1,1))); setToDate(isoDate(new Date(y,m,0))); }
    if (p==='week')       { const d=new Date(today); d.setDate(today.getDate()-6); setFromDate(isoDate(d)); setToDate(isoDate(today)); }
    if (p==='custom')     {} // user sets dates manually
  };

  useEffect(() => {
    setLoading(true);
    fetch(showInactive ? '/api/employees?active=false' : '/api/employees?active=true&with_punches=true')
      .then(r=>r.json())
      .then(d=>setEmployees((d.employees||[]).sort((a: Employee,b: Employee)=>a.full_name.localeCompare(b.full_name))))
      .finally(()=>setLoading(false));
  }, [showInactive]);

  const loadPunches = (emp: Employee) => {
    setSelected(emp); setPunches([]); setPunchLoad(true);
    fetch(`/api/employees/${emp.seven_shifts_user_id||emp.id}/punches?from=${fromDate}&to=${toDate}`)
      .then(r=>r.json())
      .then(d=>setPunches(d.punches||[]))
      .finally(()=>setPunchLoad(false));
  };

  useEffect(() => { if (selected) loadPunches(selected); }, [fromDate, toDate]);

  const locations = useMemo(()=>['ALL',...[...new Set(employees.map(e=>e.location).filter(Boolean))].sort()],[employees]);
  const filtered  = useMemo(()=>employees.filter(e=>{
    if (locFilter!=='ALL'&&e.location!==locFilter) return false;
    if (search&&!e.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }),[employees,locFilter,search]);

  // Use payroll_hours (7shifts approved) — NEVER recompute from timestamps
  const payrollHours = punches.filter(p=>p.clocked_out).reduce((s,p)=>s+(+p.payroll_hours||+p.hours||0),0);
  const estPay = payrollHours * (selected?.wage||0);

  // Ongoing shift — show elapsed
  const elapsed = (iso: string) => {
    const mins = Math.round((Date.now()-new Date(iso).getTime())/60000);
    return `${Math.floor(mins/60)}h ${mins%60}m (in progress)`;
  };

  // Export to Excel
  const downloadExcel = async () => {
    if (!selected || punches.length===0) return;
    const rows = [
      ['Employee Logbook Export'],
      [`Employee: ${selected.full_name}`],
      [`Location: ${selected.location||'—'} | Role: ${selected.role||'—'} | Wage: $${selected.wage}/hr`],
      [`Period: ${fromDate} to ${toDate}`],
      [],
      ['Date','Clock In','Clock Out','Break (min)','Payroll Hours','Location','Role','Pay'],
      ...punches.sort((a,b)=>new Date(b.clocked_in).getTime()-new Date(a.clocked_in).getTime()).map(p=>{
        const ph = +p.payroll_hours||+p.hours||0;
        return [
          fmtDate(p.clocked_in),
          fmtTime(p.clocked_in),
          p.clocked_out ? fmtTime(p.clocked_out) : 'Still In',
          p.break_minutes||0,
          ph.toFixed(2),
          p.location,
          p.role||p.department||'—',
          p.clocked_out&&selected.wage ? cad(ph*selected.wage) : '—',
        ];
      }),
      [],
      ['TOTAL','','','',payrollHours.toFixed(2),'','',selected.wage?cad(estPay):'—'],
    ];
    const csv = rows.map(r=>r.map(c=>JSON.stringify(c??'')).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`logbook_${selected.full_name.replace(/\s+/g,'_')}_${fromDate}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',display:'flex',height:'100vh'}}>

      {/* Left panel */}
      <div style={{width:280,borderRight:'1px solid rgba(255,255,255,0.07)',display:'flex',flexDirection:'column',height:'100vh',position:'sticky',top:0,flexShrink:0}}>
        <div style={{padding:'14px 12px 10px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <h1 style={{fontSize:14,fontWeight:700,color:'#f9fafb',margin:'0 0 10px'}}>Employee Logbook</h1>
          <input placeholder="Search employee…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{...sel,width:'100%',boxSizing:'border-box',marginBottom:7}}/>
          {/* Location filter */}
          <select value={locFilter} onChange={e=>setLocFilter(e.target.value)}
            style={{...sel,width:'100%',boxSizing:'border-box',marginBottom:7}}>
            {locations.map(l=><option key={l}>{l}</option>)}
          </select>
          <label style={{display:'flex',alignItems:'center',gap:7,fontSize:11,color:'#6b7280',cursor:'pointer'}}>
            <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>
            Show inactive staff
          </label>
        </div>
        <div style={{overflowY:'auto',flex:1}}>
          {loading ? <div style={{color:'#6b7280',padding:16,textAlign:'center',fontSize:12}}>Loading…</div> :
            filtered.map(emp=>(
              <div key={emp.id} onClick={()=>loadPunches(emp)}
                style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid rgba(255,255,255,0.03)',
                  background:selected?.id===emp.id?'rgba(34,211,238,0.08)':'transparent',
                  borderLeft:selected?.id===emp.id?'2px solid #22d3ee':'2px solid transparent'}}>
                <div style={{fontWeight:500,fontSize:12,color:'#f9fafb',display:'flex',alignItems:'center',gap:5}}>
                  {emp.full_name}
                  {(!emp.wage||+emp.wage===0)&&<span style={{fontSize:9,background:'rgba(248,113,113,0.2)',color:'#f87171',borderRadius:3,padding:'1px 4px'}}>$0</span>}
                </div>
                <div style={{fontSize:10,color:'#4b5563',marginTop:1}}>{emp.location} · {emp.role||emp.department}</div>
                <div style={{fontSize:10,color:'#34d399',marginTop:1}}>${(+emp.wage||0).toFixed(2)}/hr</div>
              </div>
            ))
          }
        </div>
        <div style={{padding:'7px 12px',borderTop:'1px solid rgba(255,255,255,0.07)',fontSize:10,color:'#6b7280'}}>
          {filtered.length} of {employees.length} shown
        </div>
      </div>

      {/* Right panel */}
      <div style={{flex:1,overflowY:'auto',padding:'18px 22px',minWidth:0}}>
        {!selected ? (
          <div style={{color:'#6b7280',textAlign:'center',marginTop:80}}>
            <div style={{fontSize:32,marginBottom:10}}>👤</div>
            <div style={{fontSize:14}}>Select an employee to view their logbook</div>
            <div style={{fontSize:12,marginTop:6,color:'#374151'}}>Use the location filter and search to find staff</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(34,211,238,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#22d3ee',flexShrink:0}}>
                  {selected.full_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                </div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:'#f9fafb'}}>{selected.full_name}</div>
                  <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{selected.location} · {selected.department} · {selected.role}</div>
                  {(!selected.wage||+selected.wage===0)&&<div style={{fontSize:10,color:'#f87171',marginTop:2}}>⚠ No wage set</div>}
                </div>
              </div>
              <button onClick={downloadExcel} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,padding:'6px 14px',fontSize:12,cursor:'pointer',fontWeight:500,flexShrink:0}}>
                ↓ Download CSV
              </button>
            </div>

            {/* Date range controls */}
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
              <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>
                {[{k:'month',l:'This month'},{k:'1-15',l:'1–15'},{k:'16-end',l:'16–End'},{k:'last-month',l:'Last month'},{k:'week',l:'Last 7 days'},{k:'custom',l:'Custom'}].map(b=>(
                  <button key={b.k} onClick={()=>applyPreset(b.k)} style={{padding:'4px 10px',fontSize:11,borderRadius:5,cursor:'pointer',border:'none',
                    background:preset===b.k?'rgba(34,211,238,0.2)':'rgba(255,255,255,0.06)',
                    color:preset===b.k?'#22d3ee':'#9ca3af',fontWeight:preset===b.k?600:400}}>
                    {b.l}
                  </button>
                ))}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);setPreset('custom');}} style={{...inp,width:130}}/>
                <span style={{color:'#6b7280',fontSize:12}}>→</span>
                <input type="date" value={toDate} onChange={e=>{setToDate(e.target.value);setPreset('custom');}} style={{...inp,width:130}}/>
                <button onClick={()=>loadPunches(selected)} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer'}}>
                  Apply →
                </button>
              </div>
            </div>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:16}}>
              {[
                {l:'Shifts',v:punches.length,c:'#22d3ee'},
                {l:'Payroll Hours',v:`${payrollHours.toFixed(2)}h`,c:'#a78bfa'},
                {l:'Wage',v:`$${(+selected.wage||0).toFixed(2)}/hr`,c:'#34d399'},
                {l:'Est. Pay',v:selected.wage?`$${estPay.toFixed(0)}`:'—',c:'#fbbf24'},
                {l:'Still Clocked In',v:punches.filter(p=>!p.clocked_out).length,c:'#f97316'},
              ].map(k=>(
                <div key={k.l} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:9,padding:'9px 12px'}}>
                  <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>{k.l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
                </div>
              ))}
            </div>

            {/* Punch table — payroll hours from 7shifts, break info displayed */}
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.07)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:600,color:'#f9fafb'}}>Punch History</div>
                <div style={{fontSize:10,color:'#4b5563'}}>Payroll Hrs = 7shifts approved (breaks already deducted)</div>
              </div>
              {punchLoad ? (
                <div style={{color:'#6b7280',padding:24,textAlign:'center',fontSize:12}}>Loading punches…</div>
              ) : punches.length===0 ? (
                <div style={{color:'#6b7280',padding:24,textAlign:'center',fontSize:12}}>No punches found for this period</div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:700}}>
                    <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                      {['Date','Clock In','Clock Out','Break','Payroll Hrs','Gross Hrs','Location','Role','Pay'].map(h=>(
                        <th key={h} style={{padding:'7px 10px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:9,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {punches.sort((a,b)=>new Date(b.clocked_in).getTime()-new Date(a.clocked_in).getTime()).map((p,i)=>{
                        const ph = +p.payroll_hours||+p.hours||0;
                        const gh = +p.gross_hours||ph;
                        const isLive = !p.clocked_out;
                        const pay = ph*(+selected.wage||0);
                        const bk = +p.break_minutes||0;
                        return (
                          <tr key={p.punch_id} style={{borderTop:'1px solid rgba(255,255,255,0.04)',background:isLive?'rgba(249,115,22,0.04)':i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                            <td style={{padding:'7px 10px',color:'#9ca3af',whiteSpace:'nowrap'}}>{fmtDate(p.clocked_in)}</td>
                            <td style={{padding:'7px 10px',color:'#e5e7eb',whiteSpace:'nowrap'}}>{fmtTime(p.clocked_in)}</td>
                            <td style={{padding:'7px 10px',whiteSpace:'nowrap'}}>
                              {isLive
                                ? <span style={{color:'#f97316',fontSize:10}}>{elapsed(p.clocked_in)}</span>
                                : <span style={{color:'#e5e7eb'}}>{fmtTime(p.clocked_out!)}</span>}
                            </td>
                            <td style={{padding:'7px 10px',color:bk>0?'#fbbf24':'#374151',textAlign:'center'}}>
                              {bk>0?`${bk}m`:'—'}
                            </td>
                            <td style={{padding:'7px 10px',textAlign:'right'}}>
                              {isLive
                                ? <span style={{color:'#f97316',fontSize:10}}>pending</span>
                                : <span style={{color:'#22d3ee',fontWeight:700}}>{ph.toFixed(2)}h</span>}
                            </td>
                            <td style={{padding:'7px 10px',textAlign:'right',color:gh>ph?'#6b7280':'#374151'}}>
                              {gh.toFixed(2)}h
                            </td>
                            <td style={{padding:'7px 10px',color:'#6b7280',fontSize:10}}>{p.location}</td>
                            <td style={{padding:'7px 10px',color:'#6b7280',fontSize:10}}>{p.role||p.department||'—'}</td>
                            <td style={{padding:'7px 10px',textAlign:'right',color:isLive?'#374151':'#34d399'}}>
                              {isLive?'—':(selected.wage?cad(pay):'—')}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total row */}
                      <tr style={{borderTop:'2px solid rgba(255,255,255,0.1)',background:'rgba(34,211,238,0.04)'}}>
                        <td colSpan={4} style={{padding:'9px 10px',fontWeight:700,color:'#22d3ee',fontSize:12}}>Total (payroll-approved hours)</td>
                        <td style={{padding:'9px 10px',color:'#22d3ee',fontWeight:700,textAlign:'right'}}>{payrollHours.toFixed(2)}h</td>
                        <td/><td/><td/>
                        <td style={{padding:'9px 10px',color:'#34d399',fontWeight:700,textAlign:'right'}}>{selected.wage?cad(estPay):'—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
