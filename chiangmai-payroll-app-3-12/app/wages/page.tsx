'use client';
import { useEffect, useState, useMemo } from 'react';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';
import type { EmployeeRule, RuleType } from '@/lib/types';

type Employee = {
  id: string; seven_shifts_user_id: string | null; full_name: string;
  location: string; department: string; role: string;
  wage: number; cash_wage?: number; wage_locked?: boolean; wage_source?: string;
  wage_updated_at?: string | null; wage_upgrade_note?: string | null;
  active: boolean; created_at?:string; new_until?:string; is_new?:boolean;
};

type RuleForm = {
  id?: string;
  employee_name: string;
  rule_type: RuleType;
  rule_value: string;
  combined_locations: string;
  payroll_location: string;
  notes: string;
};

const sel: React.CSSProperties = { background:'#1a1f2e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#e5e7eb',padding:'7px 12px',fontSize:13,outline:'none',cursor:'pointer' };
const PAGE_SIZE = 50;
const RULE_TYPES: RuleType[] = ['CASH_ONLY','PARTIAL_CASH','PAYROLL_HOURS_CAP','COMBINED_LOCATION_CAP','SALARY_FIXED','HOLD_PAYROLL','PAY_UNDER_OTHER_LOCATION','NOTE_ONLY'];
const emptyRuleForm: RuleForm = { employee_name:'', rule_type:'CASH_ONLY', rule_value:'', combined_locations:'', payroll_location:'', notes:'' };
const normName = (value: string) => value.trim().toLowerCase().replace(/\s+/g,' ');
const ruleLabel = (rule?: EmployeeRule) => rule ? rule.rule_type.replaceAll('_',' ') : 'Normal 88h / location';
const ruleDetails = (rule?: EmployeeRule) => {
  if (!rule) return 'Default: each worked location gets its own 88 cheque hours before cash.';
  return [
    rule.rule_value !== null && rule.rule_value !== undefined ? `Value ${rule.rule_value}` : '',
    rule.combined_locations ? `Locations: ${rule.combined_locations}` : '',
    rule.payroll_location ? `Payroll: ${rule.payroll_location}` : '',
    rule.notes || '',
  ].filter(Boolean).join(' · ') || 'No details';
};

export default function WagesPage() {
  const initial = peekJson<{employees:Employee[]}>('/api/employees?active=true');
  const [employees, setEmployees]   = useState<Employee[]>(() => initial?.employees || []);
  const initialRules = peekJson<{rules:EmployeeRule[]}>('/api/rules');
  const [rules, setRules]           = useState<EmployeeRule[]>(() => initialRules?.rules || []);
  const [rulesLoading, setRulesLoading] = useState(() => !initialRules);
  const [ruleForm, setRuleForm]     = useState<RuleForm>(emptyRuleForm);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleSearch, setRuleSearch] = useState('');
  const [loading, setLoading]       = useState(() => !initial);
  const [saving,  setSaving]        = useState<Set<string>>(new Set());
  const [saved,   setSaved]         = useState<Set<string>>(new Set());
  const [syncing, setSyncing]       = useState(false);
  const [edits,   setEdits]         = useState<Record<string,{wage:string;cash_wage:string}>>({});
  const [search,  setSearch]        = useState('');
  const [locFilter, setLocFilter]   = useState('ALL');
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage]             = useState(0);
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

  const loadRules = (force = false) => {
    const url = '/api/rules';
    const cached = !force ? peekJson<{rules:EmployeeRule[]}>(url) : undefined;
    if (cached) setRules(cached.rules || []);
    setRulesLoading(!cached);
    cachedJson<{rules:EmployeeRule[]}>(url, 120_000, force)
      .then(d => setRules((d.rules||[]).sort((a,b)=>(a.employee_name||'').localeCompare(b.employee_name||''))))
      .catch(()=>{})
      .finally(()=>setRulesLoading(false));
  };

  useEffect(()=>{ load(); loadRules(); },[]);

  const locations = useMemo(()=>['ALL',...[...new Set(employees.map(e=>e.location).filter(Boolean))].sort()],[employees]);
  const ruleByName = useMemo(()=>{
    const map = new Map<string,EmployeeRule>();
    rules.filter(rule=>rule.active!==false).forEach(rule=>map.set(normName(rule.employee_name), rule));
    return map;
  },[rules]);
  const filteredRules = useMemo(()=>rules.filter(rule=>{
    if (!ruleSearch) return true;
    const needle = ruleSearch.toLowerCase();
    return `${rule.employee_name} ${rule.rule_type} ${rule.notes||''} ${rule.combined_locations||''} ${rule.payroll_location||''}`.toLowerCase().includes(needle);
  }),[rules,ruleSearch]);

  const filtered = useMemo(()=>employees.filter(e=>{
    if (locFilter!=='ALL'&&e.location!==locFilter) return false;
    if (search&&!e.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (missingOnly&&Number(e.wage||0)>0) return false;
    return true;
  }),[employees,locFilter,search,missingOnly]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleEmployees = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(()=>setPage(0),[search,locFilter,employees.length]);

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
        invalidateClientCache(['/api/employees', '/api/payroll', '/api/payroll-report']);
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

  const setRuleField = (field: keyof RuleForm, value: string) => setRuleForm(previous=>({...previous,[field]:value}));

  const editRule = (rule: EmployeeRule) => setRuleForm({
    id: rule.id,
    employee_name: rule.employee_name || '',
    rule_type: rule.rule_type,
    rule_value: rule.rule_value === undefined || rule.rule_value === null ? '' : String(rule.rule_value),
    combined_locations: rule.combined_locations || '',
    payroll_location: rule.payroll_location || '',
    notes: rule.notes || '',
  });

  const focusRuleForm = (employee: Employee) => {
    const existing = ruleByName.get(normName(employee.full_name));
    if (existing) {
      editRule(existing);
      setRuleSearch(employee.full_name);
      setMsg({text:`Editing rule for ${employee.full_name}`,ok:true});
    } else {
      setRuleForm({...emptyRuleForm, employee_name:employee.full_name, rule_type:'NOTE_ONLY', notes:'Review payroll rule'});
      setRuleSearch('');
      setMsg({text:`Ready to add rule for ${employee.full_name}. Choose the rule type, then Apply rule.`,ok:true});
    }
    window.scrollTo({top:0,behavior:'smooth'});
    setTimeout(()=>setMsg(null),3500);
  };

  const saveRule = async () => {
    if (!ruleForm.employee_name.trim()) { setMsg({text:'Employee name is required for rule',ok:false}); return; }
    setRuleSaving(true);
    try {
      const body = {
        ...ruleForm,
        employee_name: ruleForm.employee_name.trim(),
        rule_value: ruleForm.rule_value.trim() ? Number(ruleForm.rule_value) : null,
        active: true,
      };
      const res = await fetch(ruleForm.id ? '/api/rules' : '/api/rules', {
        method: ruleForm.id ? 'PATCH' : 'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Rule save failed');
      invalidateClientCache(['/api/rules','/api/payroll','/api/payroll-report','/api/employees']);
      await loadRules(true);
      setRuleForm(emptyRuleForm);
      setMsg({text:'✓ Payroll rule saved and will apply on next refresh/sync',ok:true});
    } catch (error:any) {
      setMsg({text:error.message,ok:false});
    } finally {
      setRuleSaving(false);
      setTimeout(()=>setMsg(null),3000);
    }
  };

  const deleteRule = async (rule: EmployeeRule) => {
    if (!rule.id) return;
    if (!confirm(`Delete payroll rule for ${rule.employee_name}? It will be made inactive, not erased.`)) return;
    setRuleSaving(true);
    try {
      const res = await fetch(`/api/rules?id=${encodeURIComponent(rule.id)}`, { method:'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Rule delete failed');
      invalidateClientCache(['/api/rules','/api/payroll','/api/payroll-report','/api/employees']);
      await loadRules(true);
      if (ruleForm.id === rule.id) setRuleForm(emptyRuleForm);
      setMsg({text:'✓ Rule deleted; payroll will no longer apply it',ok:true});
    } catch (error:any) {
      setMsg({text:error.message,ok:false});
    } finally {
      setRuleSaving(false);
      setTimeout(()=>setMsg(null),3000);
    }
  };

  const syncFrom7shifts = async () => {
    setSyncing(true); setMsg(null);
    try {
      const today = new Date().toISOString().slice(0,10);
      const response = await fetch('/api/7shifts/sync', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({start:`${today}T00:00:00.000Z`,end:`${today}T23:59:59.999Z`,triggered_by:'wages-page',sync_wages:true}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '7shifts sync failed');
      invalidateClientCache(['/api/employees','/api/payroll','/api/payroll-report','/api/synclog']);
      load(true);
      const failed = result.wage_errors?.length || 0;
      const upgraded = result.wage_upgrades?.length || 0;
      setMsg({text:failed ? `Synced employee data; ${failed} wage lookups failed` : `✓ Employee data synced${upgraded ? `; ${upgraded} wage upgraded from 7shifts` : '; no higher 7shifts wages found'}`,ok:failed===0});
    } catch (error:any) {
      setMsg({text:error.message,ok:false});
    } finally {
      setSyncing(false);
    }
  };

  const exportWages = () => {
    const rows = [
      ['Employee','Location','Department','Role','Cheque Wage','Cash Wage','Wage Source','Wage Locked','Active Rule','Rule Details','Wage Updated','Notes'],
      ...filtered.map(employee => {
        const activeRule = ruleByName.get(normName(employee.full_name));
        return [
          employee.full_name,
          employee.location || '',
          employee.department || '',
          employee.role || '',
          Number(employee.wage || 0).toFixed(2),
          Number(employee.cash_wage || 0).toFixed(2),
          employee.wage_source || '',
          employee.wage_locked ? 'Yes' : 'No',
          activeRule ? activeRule.rule_type : 'Normal 88h / location',
          ruleDetails(activeRule),
          employee.wage_updated_at || '',
          employee.wage_upgrade_note || '',
        ];
      }),
    ];
    const csv = rows.map(row => row.map(cell => JSON.stringify(cell ?? '')).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cm-pay-wages_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const missingWages = employees.filter(e=>!e.wage||e.wage===0);
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
          <button onClick={exportWages} disabled={filtered.length===0} style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.25)',color:filtered.length?'#34d399':'#4b5563',borderRadius:7,padding:'7px 12px',fontSize:12,cursor:filtered.length?'pointer':'not-allowed'}}>
            ↓ Export CSV
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

      {missingWages.length>0&&<div style={{marginBottom:16,padding:'12px 14px',borderRadius:10,background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.28)'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><div><div style={{fontSize:13,fontWeight:700,color:'#f87171'}}>⚠ {missingWages.length} active employees need a wage</div><div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>{missingWages.slice(0,12).map(employee=>`${employee.full_name} (${employee.location||'No location'})`).join(' · ')}{missingWages.length>12?' …':''}</div></div><button onClick={()=>{setMissingOnly(true);setLocFilter('ALL');setSearch('');}} style={{...sel,borderColor:'rgba(248,113,113,.35)',color:'#f87171'}}>Show missing wages</button></div></div>}

      <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:16,marginBottom:18}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:12}}>
          <div>
            <h2 style={{fontSize:16,fontWeight:700,color:'#f9fafb',margin:0}}>Payroll Rules</h2>
            <p style={{fontSize:12,color:'#6b7280',margin:'4px 0 0'}}>Add, edit, apply, or delete standing employee rules. Active rules apply in Payroll Hours, Labour Cost, By Location, Dashboard, exports, and are visible in Logbook.</p>
          </div>
          <input placeholder="Search rules…" value={ruleSearch} onChange={event=>setRuleSearch(event.target.value)} style={{...sel,width:220,cursor:'text'}}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1.4fr) minmax(170px,1fr) 110px minmax(180px,1fr) minmax(160px,1fr) minmax(180px,1.2fr) auto auto',gap:8,alignItems:'center',marginBottom:14}}>
          <input list="employee-rule-names" placeholder="Employee name" value={ruleForm.employee_name} onChange={event=>setRuleField('employee_name',event.target.value)} style={{...sel,cursor:'text'}}/>
          <datalist id="employee-rule-names">{employees.map(employee=><option key={employee.id} value={employee.full_name}/>)}</datalist>
          <select value={ruleForm.rule_type} onChange={event=>setRuleField('rule_type',event.target.value)} style={sel}>
            {RULE_TYPES.map(type=><option key={type} value={type}>{type.replaceAll('_',' ')}</option>)}
          </select>
          <input placeholder="Value" type="number" step="0.01" value={ruleForm.rule_value} onChange={event=>setRuleField('rule_value',event.target.value)} style={{...sel,cursor:'text'}}/>
          <input placeholder="Combined/cash locations" value={ruleForm.combined_locations} onChange={event=>setRuleField('combined_locations',event.target.value)} style={{...sel,cursor:'text'}}/>
          <input placeholder="Payroll location" value={ruleForm.payroll_location} onChange={event=>setRuleField('payroll_location',event.target.value)} style={{...sel,cursor:'text'}}/>
          <input placeholder="Notes" value={ruleForm.notes} onChange={event=>setRuleField('notes',event.target.value)} style={{...sel,cursor:'text'}}/>
          <button onClick={saveRule} disabled={ruleSaving} style={{background:'rgba(34,211,238,0.12)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,cursor:ruleSaving?'wait':'pointer',whiteSpace:'nowrap'}}>{ruleForm.id?'Update rule':'Apply rule'}</button>
          <button onClick={()=>setRuleForm(emptyRuleForm)} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:7,padding:'8px 12px',fontSize:12,cursor:'pointer'}}>Clear</button>
        </div>
        <div style={{border:'1px solid rgba(255,255,255,0.06)',borderRadius:10,overflow:'hidden',maxHeight:260,overflowY:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr style={{background:'rgba(0,0,0,0.22)'}}>
              {['EMPLOYEE','RULE','VALUE / LOCATIONS','NOTES',''].map(header=><th key={header} style={{padding:'8px 10px',textAlign:'left',color:'#6b7280',fontSize:10,fontWeight:600,letterSpacing:'.06em'}}>{header}</th>)}
            </tr></thead>
            <tbody>
              {rulesLoading ? <tr><td colSpan={5} style={{padding:18,color:'#6b7280',textAlign:'center'}}>Loading rules…</td></tr> :
              filteredRules.length===0 ? <tr><td colSpan={5} style={{padding:18,color:'#6b7280',textAlign:'center'}}>No active rules found</td></tr> :
              filteredRules.map(rule=>(
                <tr key={rule.id || `${rule.employee_name}-${rule.rule_type}`} style={{borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                  <td style={{padding:'8px 10px',fontWeight:600,color:'#f9fafb'}}>{rule.employee_name}</td>
                  <td style={{padding:'8px 10px'}}><span style={{fontSize:10,color:'#a78bfa',background:'rgba(167,139,250,.12)',border:'1px solid rgba(167,139,250,.22)',borderRadius:5,padding:'3px 6px'}}>{rule.rule_type.replaceAll('_',' ')}</span></td>
                  <td style={{padding:'8px 10px',color:'#9ca3af'}}>{rule.rule_value !== null && rule.rule_value !== undefined ? `Value ${rule.rule_value}` : '—'}{rule.combined_locations?` · ${rule.combined_locations}`:''}{rule.payroll_location?` · Payroll ${rule.payroll_location}`:''}</td>
                  <td style={{padding:'8px 10px',color:'#6b7280'}}>{rule.notes || '—'}</td>
                  <td style={{padding:'8px 10px',textAlign:'right',whiteSpace:'nowrap'}}>
                    <button onClick={()=>editRule(rule)} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'#22d3ee',borderRadius:6,padding:'5px 10px',fontSize:11,cursor:'pointer',marginRight:6}}>Edit</button>
                    <button onClick={()=>deleteRule(rule)} disabled={!rule.id || ruleSaving} style={{background:'rgba(248,113,113,0.08)',border:'1px solid rgba(248,113,113,0.25)',color:'#f87171',borderRadius:6,padding:'5px 10px',fontSize:11,cursor:ruleSaving?'wait':'pointer'}}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        <input placeholder="Search employee…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{...sel,width:220}}/>
        <select value={locFilter} onChange={e=>setLocFilter(e.target.value)} style={{...sel,maxWidth:240}}>
          {locations.map(l=><option key={l}>{l}</option>)}
        </select>
        <button onClick={()=>{setSearch('');setLocFilter('ALL');setMissingOnly(false);}} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.08)',color:'#6b7280',borderRadius:7,padding:'7px 12px',fontSize:12,cursor:'pointer'}}>Clear</button>
        <button onClick={()=>setMissingOnly(value=>!value)} style={{...sel,color:missingOnly?'#f87171':'#9ca3af',borderColor:missingOnly?'rgba(248,113,113,.4)':'rgba(255,255,255,.1)'}}>{missingOnly?'Showing missing only':'Missing wages'}</button>
        <span style={{marginLeft:'auto',fontSize:11,color:'#6b7280',alignSelf:'center'}}>
          {filtered.length ? `${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,filtered.length)} of ${filtered.length}` : '0 employees'}
        </span>
        <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))} style={{...sel,opacity:page===0?0.4:1}}>Previous</button>
        <button disabled={page>=pageCount-1} onClick={()=>setPage(p=>Math.min(pageCount-1,p+1))} style={{...sel,opacity:page>=pageCount-1?0.4:1}}>Next</button>
      </div>

      {loading ? (
        <div style={{color:'#6b7280',padding:60,textAlign:'center'}}>Loading employees…</div>
      ) : (
        <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead><tr style={{background:'rgba(0,0,0,0.25)'}}>
              {['EMPLOYEE','LOCATION','DEPT / ROLE','PAYROLL WAGE ($/HR)','CASH WAGE ($/HR)','PAY TYPE / RULE',''].map(h=>(
                <th key={h} style={{padding:'10px 16px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length===0?(
                <tr><td colSpan={7} style={{padding:40,textAlign:'center',color:'#6b7280'}}>No employees found</td></tr>
              ):visibleEmployees.map((emp,i)=>{
                const isSaving = saving.has(emp.id);
                const isSaved  = saved.has(emp.id);
                const hasEdit  = !!edits[emp.id];
                const curWage  = parseFloat(getEdit(emp.id,'wage',emp.wage||0));
                const noWage   = !emp.wage || emp.wage===0;
                const activeRule = ruleByName.get(normName(emp.full_name));
                return (
                  <tr key={emp.id} style={{borderTop:'1px solid rgba(255,255,255,0.05)',background:emp.is_new?'rgba(34,211,238,.07)':i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                    <td style={{padding:'10px 16px'}}>
                      <div style={{fontWeight:500,color:'#f9fafb',display:'flex',alignItems:'center',gap:6}}>
                        {emp.full_name}
                        {emp.is_new&&<span title={`New through ${emp.new_until}`} style={{fontSize:9,background:'rgba(34,211,238,.18)',color:'#22d3ee',borderRadius:3,padding:'1px 5px'}}>NEW</span>}
                        {noWage&&<span style={{fontSize:9,background:'rgba(248,113,113,0.2)',color:'#f87171',borderRadius:3,padding:'1px 5px'}}>$0</span>}
                        {hasEdit&&<span style={{fontSize:9,background:'rgba(251,191,36,0.2)',color:'#fbbf24',borderRadius:3,padding:'1px 5px'}}>edited</span>}
                        {emp.wage_source==='7shifts-upgraded'&&<span title={emp.wage_upgrade_note || 'Wage upgraded from 7shifts'} style={{fontSize:9,background:'rgba(34,211,238,0.16)',color:'#22d3ee',borderRadius:3,padding:'1px 5px'}}>7shifts upgraded</span>}
                        {emp.wage_locked&&<span style={{fontSize:9,background:'rgba(52,211,153,0.14)',color:'#34d399',borderRadius:3,padding:'1px 5px'}}>{emp.wage_source==='roster-2026'?'roster locked':'saved'}</span>}
                        {activeRule&&<span title={activeRule.notes || activeRule.rule_type} style={{fontSize:9,background:'rgba(167,139,250,0.16)',color:'#a78bfa',borderRadius:3,padding:'1px 5px'}}>{activeRule.rule_type.replaceAll('_',' ')}</span>}
                      </div>
                      {emp.wage_upgrade_note&&<div style={{fontSize:10,color:'#22d3ee',marginTop:4}}>{emp.wage_upgrade_note}</div>}
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
                    <td style={{padding:'10px 16px',minWidth:235}}>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                        <span title="Cheque payroll wage" style={{fontSize:10,background:'rgba(167,139,250,.12)',border:'1px solid rgba(167,139,250,.22)',color:'#a78bfa',borderRadius:5,padding:'3px 6px'}}>Cheque ${Number(emp.wage||0).toFixed(2)}</span>
                        <span title="Cash wage" style={{fontSize:10,background:'rgba(251,191,36,.10)',border:'1px solid rgba(251,191,36,.22)',color:'#fbbf24',borderRadius:5,padding:'3px 6px'}}>Cash ${Number(emp.cash_wage||0).toFixed(2)}</span>
                      </div>
                      <div title={ruleDetails(activeRule)} style={{fontSize:10,color:activeRule?'#a78bfa':'#6b7280',marginTop:5}}>
                        Rule: {ruleLabel(activeRule)}
                      </div>
                      <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
                        <button onClick={()=>focusRuleForm(emp)} style={{background:'rgba(34,211,238,0.10)',border:'1px solid rgba(34,211,238,0.25)',color:'#22d3ee',borderRadius:6,padding:'4px 8px',fontSize:10,cursor:'pointer'}}>{activeRule?'Edit rule':'Add rule'}</button>
                        {activeRule&&<button onClick={()=>deleteRule(activeRule)} disabled={ruleSaving} style={{background:'rgba(248,113,113,0.08)',border:'1px solid rgba(248,113,113,0.25)',color:'#f87171',borderRadius:6,padding:'4px 8px',fontSize:10,cursor:ruleSaving?'wait':'pointer'}}>Remove</button>}
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
