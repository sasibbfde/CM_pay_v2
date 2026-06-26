'use client';
import { useEffect, useState, useMemo } from 'react';

type Employee = {
  id: string; seven_shifts_user_id: string; full_name: string;
  location: string; department: string; role: string;
  wage: number; cash_wage: number; active: boolean;
};
type Punch = {
  punch_id: string; location: string; department: string; role: string;
  clocked_in: string; clocked_out: string; hours: number; wage: number;
  employee_name: string;
};

const sel: React.CSSProperties = {
  background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,
  color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer',
};
const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-CA',{month:'short',day:'numeric'}) : '—';
const cad = (n: number) => `$${(n||0).toFixed(2)}`;

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected]   = useState<Employee | null>(null);
  const [punches, setPunches]     = useState<Punch[]>([]);
  const [loading, setLoading]     = useState(true);
  const [punchLoading, setPunchLoading] = useState(false);
  const [search, setSearch]       = useState('');
  const [locFilter, setLocFilter] = useState('ALL');
  const [year, setYear]           = useState(new Date().getFullYear());
  const [month, setMonth]         = useState(new Date().getMonth() + 1);

  useEffect(() => {
    fetch('/api/employees')
      .then(r => r.json())
      .then(d => {
        const list = (d.employees || []).sort((a: Employee, b: Employee) => a.full_name.localeCompare(b.full_name));
        setEmployees(list);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadPunches = (emp: Employee) => {
    setSelected(emp); setPunches([]); setPunchLoading(true);
    fetch(`/api/employees/${emp.seven_shifts_user_id || emp.id}/punches?year=${year}&month=${month}`)
      .then(r => r.json())
      .then(d => setPunches(d.punches || []))
      .finally(() => setPunchLoading(false));
  };

  useEffect(() => { if (selected) loadPunches(selected); }, [year, month]);

  const locations = useMemo(() => ['ALL', ...[...new Set(employees.map(e => e.location).filter(Boolean))].sort()], [employees]);
  const filtered  = useMemo(() => employees.filter(e => {
    if (locFilter !== 'ALL' && e.location !== locFilter) return false;
    if (search && !e.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [employees, locFilter, search]);

  const punchStats = useMemo(() => ({
    totalHours: punches.reduce((s, p) => s + (p.hours || 0), 0),
    totalPay:   punches.reduce((s, p) => s + (p.hours || 0) * (selected?.wage || 0), 0),
    shifts:     punches.length,
    locations:  [...new Set(punches.map(p => p.location))],
  }), [punches, selected]);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',display:'flex',height:'100vh'}}>
      {/* Left panel - employee list */}
      <div style={{width:320,borderRight:'1px solid rgba(255,255,255,0.07)',display:'flex',flexDirection:'column',height:'100vh',position:'sticky',top:0}}>
        <div style={{padding:'20px 16px 12px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <h1 style={{fontSize:16,fontWeight:700,color:'#f9fafb',margin:'0 0 12px'}}>Employee Logbook</h1>
          <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{...sel,width:'100%',boxSizing:'border-box',marginBottom:8}}/>
          <select value={locFilter} onChange={e=>setLocFilter(e.target.value)} style={{...sel,width:'100%',boxSizing:'border-box'}}>
            {locations.map(l=><option key={l}>{l}</option>)}
          </select>
        </div>
        <div style={{overflowY:'auto',flex:1}}>
          {loading ? <div style={{color:'#6b7280',padding:20,textAlign:'center'}}>Loading…</div> :
            filtered.map(emp => (
              <div key={emp.id} onClick={()=>loadPunches(emp)}
                style={{padding:'10px 16px',cursor:'pointer',borderBottom:'1px solid rgba(255,255,255,0.05)',
                  background:selected?.id===emp.id?'rgba(34,211,238,0.08)':'transparent',
                  borderLeft:selected?.id===emp.id?'2px solid #22d3ee':'2px solid transparent'}}>
                <div style={{fontWeight:500,fontSize:13,color:emp.active?'#f9fafb':'#6b7280'}}>
                  {emp.full_name}{!emp.active&&<span style={{fontSize:10,color:'#f87171',marginLeft:6}}>INACTIVE</span>}
                </div>
                <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{emp.location} · {emp.role||emp.department}</div>
                <div style={{fontSize:11,color:'#34d399',marginTop:1}}>${(emp.wage||0).toFixed(2)}/hr{emp.cash_wage>0&&` · cash $${emp.cash_wage.toFixed(2)}/hr`}</div>
              </div>
            ))
          }
        </div>
        <div style={{padding:'10px 16px',borderTop:'1px solid rgba(255,255,255,0.07)',fontSize:11,color:'#6b7280'}}>
          {filtered.length} of {employees.length} employees
        </div>
      </div>

      {/* Right panel - logbook */}
      <div style={{flex:1,overflowY:'auto',padding:'24px 28px'}}>
        {!selected ? (
          <div style={{color:'#6b7280',textAlign:'center',marginTop:80}}>
            <div style={{fontSize:40,marginBottom:12}}>👤</div>
            <div style={{fontSize:15}}>Select an employee to view their logbook</div>
          </div>
        ) : (
          <>
            {/* Employee header */}
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(34,211,238,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:'#22d3ee'}}>
                    {selected.full_name.split(' ').map(n=>n[0]).join('').slice(0,2)}
                  </div>
                  <div>
                    <h2 style={{fontSize:20,fontWeight:700,color:'#f9fafb',margin:0}}>{selected.full_name}</h2>
                    <div style={{fontSize:13,color:'#6b7280',marginTop:2}}>{selected.location} · {selected.department} · {selected.role}</div>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <select value={year} onChange={e=>setYear(+e.target.value)} style={sel}>
                  {[2024,2025,2026].map(y=><option key={y}>{y}</option>)}
                </select>
                <select value={month} onChange={e=>setMonth(+e.target.value)} style={sel}>
                  {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:24}}>
              {[
                {label:'Shifts',val:punchStats.shifts,color:'#22d3ee'},
                {label:'Total hours',val:`${punchStats.totalHours.toFixed(2)}h`,color:'#a78bfa'},
                {label:'Payroll wage',val:`$${(selected.wage||0).toFixed(2)}/hr`,color:'#34d399'},
                {label:'Est. pay',val:`$${punchStats.totalPay.toFixed(0)}`,color:'#fbbf24'},
                {label:'Locations',val:punchStats.locations.length,color:'#60a5fa'},
              ].map(k=>(
                <div key={k.label} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'10px 14px'}}>
                  <div style={{fontSize:10,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em'}}>{k.label}</div>
                  <div style={{fontSize:18,fontWeight:700,color:k.color,marginTop:2}}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* Punch history */}
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,0.07)',fontSize:13,fontWeight:600,color:'#f9fafb'}}>
                Punch history — {MONTHS[month-1]} {year}
              </div>
              {punchLoading ? (
                <div style={{color:'#6b7280',padding:30,textAlign:'center'}}>Loading punches…</div>
              ) : punches.length === 0 ? (
                <div style={{color:'#6b7280',padding:30,textAlign:'center'}}>No punches for this period</div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'rgba(0,0,0,0.2)'}}>
                      {['Date','Clock in','Clock out','Hours','Location','Role','Pay'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {punches.sort((a,b)=>new Date(b.clocked_in).getTime()-new Date(a.clocked_in).getTime()).map((p,i)=>(
                      <tr key={p.punch_id} style={{borderTop:'1px solid rgba(255,255,255,0.04)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                        <td style={{padding:'8px 14px',color:'#9ca3af',whiteSpace:'nowrap'}}>{fmtDate(p.clocked_in)}</td>
                        <td style={{padding:'8px 14px',color:'#e5e7eb',whiteSpace:'nowrap'}}>{fmt(p.clocked_in)}</td>
                        <td style={{padding:'8px 14px',color:'#e5e7eb',whiteSpace:'nowrap'}}>{p.clocked_out?fmt(p.clocked_out):<span style={{color:'#f87171'}}>Still clocked in</span>}</td>
                        <td style={{padding:'8px 14px',color:'#22d3ee',fontWeight:600,textAlign:'right'}}>{(p.hours||0).toFixed(2)}h</td>
                        <td style={{padding:'8px 14px',color:'#9ca3af'}}>{p.location}</td>
                        <td style={{padding:'8px 14px',color:'#9ca3af'}}>{p.role||p.department||'—'}</td>
                        <td style={{padding:'8px 14px',color:'#34d399',textAlign:'right'}}>{cad((p.hours||0)*(selected.wage||0))}</td>
                      </tr>
                    ))}
                    <tr style={{borderTop:'2px solid rgba(255,255,255,0.1)',background:'rgba(34,211,238,0.04)'}}>
                      <td colSpan={3} style={{padding:'9px 14px',fontWeight:600,color:'#22d3ee'}}>Total</td>
                      <td style={{padding:'9px 14px',color:'#22d3ee',fontWeight:700,textAlign:'right'}}>{punchStats.totalHours.toFixed(2)}h</td>
                      <td colSpan={2}/>
                      <td style={{padding:'9px 14px',color:'#34d399',fontWeight:700,textAlign:'right'}}>{cad(punchStats.totalPay)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
