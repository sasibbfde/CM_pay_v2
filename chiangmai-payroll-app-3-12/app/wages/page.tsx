'use client';
import { useEffect, useState, useMemo } from 'react';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';

type Employee = {
  id: string; seven_shifts_user_id: string | null; full_name: string;
  location: string; department: string; role: string;
  wage: number; cash_wage?: number; wage_locked?: boolean; wage_source?: string; active: boolean;
};

const sel: React.CSSProperties = { background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer' };

export default function WagesPage() {
  const initial = peekJson<{employees:Employee[]}>('/api/employees?active=true');
  const [employees, setEmployees]   = useState<Employee[]>(() => initial?.employees || []);
  const [loading, setLoading]       = useState(() => !initial);
  const [saving,  setSaving]        = useState<Set<string>>(new Set());
  const [saved,   setSaved]         = useState<Set<string>>(new Set());
  const [syncing, setSyncing]       = useState(false);
  const [edits,   setEdits]         = useState<Record<string,{wage:string;cash_wage:string}>>({});
  const [search,  setSearch]        = useState('');
  const [locFilter, setLocFilter]   = useState('ALL');
  const [msg, setMsg]               = useState<{text:string;ok:boolean}|null>(null);

  const load = (force = false) => {
    const url = '/api/employees?active=true';
    const cached = !force ? peekJson<{employees:Employee[]}>(url) : undefined;
    if (cached) setEmployees(cached.employees || []);
    setLoading(!cached);
    cachedJson<{employees:Employee[]}>(url, 120_000, force)
      .then(d => {
        const list = (d.employees||[]).sort((a: Employee,b: Employee)=>(a.full_name||'').localeCompare(b.full_name||''));
        setEmployees(list);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };

  useEffect(()=>{ load(); },[]);

  const locations = useMemo(()=>['ALL',...[...new Set(employees.map(e=>e.location).filter(Boolean))].sort()],[employees]);

  const filtered = useMemo(()=>employees.filter(e=>{
    if (locFilter!=='ALL'&&e.location!==locFilter) return false;
    if (search&&!e.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }),[employees,locFilter,search]);

  const getEdit = (id: string, field: 'wage'|'cash_wage', fallback: number) =>
    edits[id]?.[field] ?? String(fallback||0);

  const setEdit = (id: string, field: 'wage'|'cash_wage', val: string) =>
    setEdits(p=>({...p,[id]:{...p[id]||{wage:'',cash_wage:''},[field]:val}}));

  const saveOne = async (emp: Employee) => {
    setSaving(p=>new Set([...p,emp.id]));
    const wage      = parseFloat(getEdit(emp.id,'wage',emp.wage));
    const cash_wage = parseFloat(getEdit(emp.id,'cash_wage',emp.cash_wage??0));
    try {
      const res = await fetch('/api/employees',{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({id:emp.id, seven_shifts_user_id:emp.seven_shifts_user_id, wage, cash_wage}),
      });
      const d = await res.json();
      if (d.ok) {
        invalidateClientCache(['/api/employees', '/api/payroll']);
        setEmployees(p=>p.map(e=>e.id===emp.id?{...e,wage,cash_wage,wage_locked:true,wage_source:'manual'}:e));
        setSaved(p=>new Set([...p,emp.id]));
        setTimeout(()=>setSaved(p=>{const n=new Set(p);n.delete(emp.id);return n;}),2000);
      } else {
        setMsg({text:`Error: ${d.error}`,ok:false});
      }
    } catch(e:any){setMsg({text:e.message,ok:false});}
    setSaving(p=>{const n=new Set(p);n.delete(emp.id);return n;});
    setTimeout(()=>setMsg(null),3000);
  };

  // Save all edited in current filter
  const saveAll = async () => {
    const toSave = filtered.filter(e=>edits[e.id]);
    if(!toSave.length){setMsg({text:'No changes to save',ok:false});return;}
    for(const e of toSave) await saveOne(e);
    setMsg({text:`✓ Saved ${toSave.length} employees`,ok:true});
  };

  const syncFrom7shifts = async () => {
    setSyncing(true); setMsg(null);
    try {
      const today = new Date().toISOString().slice(0,10);
      const response = await fetch('/api/7shifts/sync', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({start:`${today}T00:00:00.000Z`,end:`${today}T23:59:59.999Z`,triggered_by:'wages-page'}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '7shifts sync failed');
      invalidateClientCache(['/api/employees','/api/payroll','/api/synclog']);
      load(true);
      const failed = result.wage_errors?.length || 0;
      setMsg({text:failed ? `Synced employee data; ${failed} wage lookups failed` : '✓ Employee data synced; locked wages preserved',ok:failed===0});
    } catch (error:any) {
      setMsg({text:error.message,ok:false});
    } finally {
      setSyncing(false);
    }
  };

  const zeroWageCount = filtered.filter(e=>!e.wage||e.wage===0).length;
  const editCount = Object.keys(edits).filter(id=>filtered.find(e=>e.id===id)).length;

  return (
    <div style={{background:'#0a0c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'24px 32px'}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'#f9fafb',margin:0}}>Edit Wages</h1>
          <p style={{color:'#6b7280',fontSize:13,margin:'4px 0 0'}}>
            {loading ? 'Loading…' : `${filtered.length} employees`}
            {zeroWageCount>0&&<span style={{color:'#f87171',marginLeft:8}}>· {zeroWageCount} missing wage</span>}
            {editCount>0&&<span style={{color:'#fbbf24',marginLeft:8}}>· {editCount} unsaved changes</span>}
          </p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {msg&&<span style={{fontSize:12,color:msg.ok?'#34d399':'#f87171',background:msg.ok?'rgba(52,211,153,0.1)':'rgba(248,113,113,0.1)',padding:'5px 12px',borderRadius:6}}>{msg.text}</span>}
          <button onClick={syncFrom7shifts} disabled={syncing} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,padding:'7px 12px',fontSize:12,cursor:syncing?'wait':'pointer'}}>
            {syncing?'Syncing…':'↻ Sync employee data'}
          </button>
          {editCount>0&&(
            <button onClick={saveAll} style={{background:'rgba(34,211,238,0.12)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:7,padding:'7px 16px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
              Save all changes ({editCount})
            </button>
          )}
          <button onClick={()=>load(true)} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:7,padding:'7px 12px',fontSize:13,cursor:'pointer'}}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        <input placeholder="Search employee…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{...sel,width:220}}/>
        <select value={locFilter} onChange={e=>setLocFilter(e.target.value)} style={{...sel,maxWidth:240}}>
          {locations.map(l=><option key={l}>{l}</option>)}
        </select>
        <button onClick={()=>{setSearch('');setLocFilter('ALL');}} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.08)',color:'#6b7280',borderRadius:7,padding:'7px 12px',fontSize:12,cursor:'pointer'}}>Clear</button>
      </div>

      {loading ? (
        <div style={{color:'#6b7280',padding:60,textAlign:'center'}}>Loading employees…</div>
      ) : (
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
              {['EMPLOYEE','LOCATION','DEPT / ROLE','PAYROLL WAGE ($/HR)','CASH WAGE ($/HR)',''].map(h=>(
                <th key={h} style={{padding:'10px 16px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length===0?(
                <tr><td colSpan={6} style={{padding:40,textAlign:'center',color:'#6b7280'}}>No employees found</td></tr>
              ):filtered.map((emp,i)=>{
                const isSaving = saving.has(emp.id);
                const isSaved  = saved.has(emp.id);
                const hasEdit  = !!edits[emp.id];
                const curWage  = parseFloat(getEdit(emp.id,'wage',emp.wage||0));
                const noWage   = !emp.wage || emp.wage===0;
                return (
                  <tr key={emp.id} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                    <td style={{padding:'10px 16px'}}>
                      <div style={{fontWeight:500,color:'#f9fafb',display:'flex',alignItems:'center',gap:6}}>
                        {emp.full_name}
                        {noWage&&<span style={{fontSize:9,background:'rgba(248,113,113,0.2)',color:'#f87171',borderRadius:3,padding:'1px 5px'}}>$0</span>}
                        {hasEdit&&<span style={{fontSize:9,background:'rgba(251,191,36,0.2)',color:'#fbbf24',borderRadius:3,padding:'1px 5px'}}>edited</span>}
                        {emp.wage_locked&&<span style={{fontSize:9,background:'rgba(52,211,153,0.14)',color:'#34d399',borderRadius:3,padding:'1px 5px'}}>{emp.wage_source==='roster-2026'?'roster locked':'saved'}</span>}
                      </div>
                    </td>
                    <td style={{padding:'10px 16px',color:'#6b7280',fontSize:12}}>{emp.location||'—'}</td>
                    <td style={{padding:'10px 16px',color:'#6b7280',fontSize:12}}>{emp.department} · {emp.role}</td>
                    <td style={{padding:'10px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{color:'#6b7280'}}>$</span>
                        <input type="number" step="0.10" min="0" max="100"
                          value={getEdit(emp.id,'wage',emp.wage||0)}
                          onChange={e=>setEdit(emp.id,'wage',e.target.value)}
                          style={{background:'#0d1117',border:`1px solid ${noWage?'rgba(248,113,113,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:6,color:'#f9fafb',padding:'5px 8px',fontSize:13,width:80,outline:'none'}}
                        />
                        <span style={{fontSize:11,color:curWage>=20?'#34d399':curWage>=17.6?'#fbbf24':'#f87171'}}>${curWage.toFixed(2)}</span>
                      </div>
                    </td>
                    <td style={{padding:'10px 16px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{color:'#6b7280'}}>$</span>
                        <input type="number" step="0.10" min="0" max="100"
                          value={getEdit(emp.id,'cash_wage',emp.cash_wage||0)}
                          onChange={e=>setEdit(emp.id,'cash_wage',e.target.value)}
                          style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,color:'#f9fafb',padding:'5px 8px',fontSize:13,width:80,outline:'none'}}
                        />
                      </div>
                    </td>
                    <td style={{padding:'10px 16px',textAlign:'right'}}>
                      <button onClick={()=>saveOne(emp)} disabled={isSaving}
                        style={{background:isSaved?'rgba(52,211,153,0.15)':hasEdit?'rgba(34,211,238,0.15)':'rgba(255,255,255,0.05)',border:`1px solid ${isSaved?'rgba(52,211,153,0.4)':hasEdit?'rgba(34,211,238,0.3)':'rgba(255,255,255,0.1)'}`,color:isSaved?'#34d399':hasEdit?'#22d3ee':'#6b7280',borderRadius:6,padding:'5px 14px',fontSize:12,cursor:isSaving?'wait':'pointer',fontWeight:hasEdit?600:400}}>
                        {isSaving?'Saving…':isSaved?'✓ Saved':'Save'}
                      </button>
                    </td>
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
