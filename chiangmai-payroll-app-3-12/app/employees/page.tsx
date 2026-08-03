'use client';
import { useEffect, useState, useMemo } from 'react';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';
import type { EmployeeRule } from '@/lib/types';

type Employee = {
  id: string; employee_id?: string; seven_shifts_user_id: string; full_name: string;
  location: string; department: string; role: string;
  wage: number; cash_wage: number; wage_source?: string | null; wage_updated_at?: string | null; wage_upgrade_note?: string | null;
  detail_updated_at?: string | null; detail_change_note?: string | null;
  active: boolean; status?: string; created_at?:string; new_until?:string; is_new?:boolean; is_new_this_month?:boolean;
  first_seen_date?: string | null; first_payroll_date?: string | null; last_payroll_date?: string | null; last_punch_at?: string | null;
  payroll_hours_since_jan?: number; worked_locations_since_jan?: string[];
};
type Punch = {
  punch_id: string; location: string; department: string; role: string;
  clocked_in: string; clocked_out: string | null;
  hours: number; payroll_hours: number; gross_hours: number; break_minutes: number; wage: number; cash_wage: number;
  punch_source: string | null;
  source: string | null;
};
type PayrollAlert = {
  id: string;
  type: string;
  employee_name: string;
  location: string;
  alert_date: string;
  severity: 'warning' | 'critical';
  message: string;
};

const sel: React.CSSProperties = { background:'#1a1f2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#e5e7eb', padding:'7px 10px', fontSize:12, outline:'none', cursor:'pointer' };
const inp: React.CSSProperties = { background:'#0d1117', border:'1px solid rgba(255,255,255,0.12)', borderRadius:6, color:'#f9fafb', padding:'5px 8px', fontSize:12, outline:'none' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const EMPLOYEE_PAGE_SIZE = 75;

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-CA',{month:'short',day:'numeric',weekday:'short'}); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit',hour12:true}); }
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function cad(n: number) { return `$${n.toFixed(2)}`; }
function shortDate(value?: string | null) { return value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '—'; }
const normName = (value: string) => value.trim().toLowerCase().replace(/\s+/g,' ');
const isIsoDate = (value: string | null) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
function punchSourceLabel(source: string | null | undefined) {
  const raw = String(source || '').trim();
  if (!raw) return '7punches';
  const normalized = raw.toLowerCase();
  if (normalized === 'web') return 'Web';
  if (normalized.includes('web')) return 'Web';
  return '7punches';
}
function isWebPunchSource(source: string | null | undefined) {
  const normalized = String(source || '').trim().toLowerCase();
  return normalized === 'web' || normalized.includes('web');
}
function displayPunchSource(punch: Pick<Punch, 'punch_source'|'source'>) {
  return punchSourceLabel(punch.punch_source || punch.source);
}
function isWebPunch(punch: Pick<Punch, 'punch_source'|'source'>) {
  return isWebPunchSource(punch.punch_source || punch.source);
}

export default function EmployeesPage() {
  const today = new Date();
  const initialEmployeeUrl = '/api/employees?active=all';
  const initialEmployees = peekJson<{employees:Employee[]}>(initialEmployeeUrl);
  const initialRules = peekJson<{rules:EmployeeRule[]}>('/api/rules');
  const [employees, setEmployees]  = useState<Employee[]>(() => initialEmployees?.employees || []);
  const [rules, setRules]          = useState<EmployeeRule[]>(() => initialRules?.rules || []);
  const [selected,  setSelected]   = useState<Employee | null>(null);
  const [punches,   setPunches]    = useState<Punch[]>([]);
  const [loading,   setLoading]    = useState(() => !initialEmployees);
  const [punchLoad, setPunchLoad]  = useState(false);
  const [punchError, setPunchError] = useState('');
  const [punchRefresh, setPunchRefresh] = useState(0);
  const [periodSyncing, setPeriodSyncing] = useState(false);
  const [periodSyncMessage, setPeriodSyncMessage] = useState('');
  const [alerts, setAlerts] = useState<PayrollAlert[]>([]);
  const [search,    setSearch]     = useState('');
  const [locFilter, setLocFilter]  = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [employeeMessage, setEmployeeMessage] = useState('');
  const [employeePage, setEmployeePage] = useState(0);
  // Date range — default to current month
  const [fromDate, setFromDate] = useState(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`);
  const [toDate,   setToDate]   = useState(isoDate(new Date(today.getFullYear(), today.getMonth()+1, 0)));
  const [preset,   setPreset]   = useState('month');
  const [filterYear, setFilterYear] = useState(today.getFullYear());
  const [filterMonth, setFilterMonth] = useState(today.getMonth()+1);
  const [filterPeriod, setFilterPeriod] = useState('month');

  const applyMonthPeriod = (year:number, month:number, period:string) => {
    setFilterYear(year); setFilterMonth(month); setFilterPeriod(period); setPreset(period);
    const prefix = `${year}-${String(month).padStart(2,'0')}`;
    const lastDay = String(new Date(year, month, 0).getDate()).padStart(2,'0');
    setFromDate(`${prefix}-${period==='16-end'?'16':'01'}`);
    setToDate(`${prefix}-${period==='1-15'?'15':lastDay}`);
  };

  const applyPreset = (p: string) => {
    setPreset(p);
    const y=today.getFullYear(), m=today.getMonth();
    if (p==='month'||p==='1-15'||p==='16-end') applyMonthPeriod(y,m+1,p);
    if (p==='last-month') { const previous=new Date(y,m-1,1); applyMonthPeriod(previous.getFullYear(),previous.getMonth()+1,'month'); setPreset('last-month'); }
    if (p==='week')       { const d=new Date(today); d.setDate(today.getDate()-6); setFromDate(isoDate(d)); setToDate(isoDate(today)); setFilterPeriod('custom'); }
    if (p==='custom')     setFilterPeriod('custom');
  };

  useEffect(() => {
    const url = '/api/employees?active=all';
    const cached = peekJson<{employees:Employee[]}>(url);
    if (cached) setEmployees(cached.employees || []);
    setLoading(!cached);
    cachedJson<{employees:Employee[]}>(url)
      .then(d=>setEmployees((d.employees||[]).sort((a: Employee,b: Employee)=>a.full_name.localeCompare(b.full_name))))
      .finally(()=>setLoading(false));
  }, []);

  useEffect(() => {
    const requested = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('alert');
    if (!requested || selected || employees.length === 0) return;
    const match = employees.find(employee => employee.full_name.toLowerCase().includes(requested.toLowerCase()));
    if (match) setSelected(match);
  }, [employees, selected]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    if (!isIsoDate(from) && !isIsoDate(to)) return;
    if (isIsoDate(from)) setFromDate(from!);
    if (isIsoDate(to)) setToDate(to!);
    setPreset('custom');
    setFilterPeriod('custom');
  }, []);

  useEffect(() => {
    cachedJson<{rules:EmployeeRule[]}>('/api/rules', 120_000)
      .then(data=>setRules(data.rules || []))
      .catch(()=>{});
  }, []);

  const loadPunches = (emp: Employee) => setSelected(emp);

  useEffect(() => {
    if (!selected) return;
    const url = `/api/employees/${selected.seven_shifts_user_id||selected.id}/punches?from=${fromDate}&to=${toDate}`;
    const cached = peekJson<{punches:Punch[]}>(url);
    setPunchError('');
    if (cached) setPunches(cached.punches || []);
    else setPunches([]);
    setPunchLoad(!cached);
    cachedJson<{punches:Punch[]}>(url, 120_000)
      .then(d=>setPunches(d.punches||[]))
      .catch(error=>{setPunches([]);setPunchError(error.message || 'Unable to load punches');})
      .finally(()=>setPunchLoad(false));
  }, [fromDate, toDate, selected, punchRefresh]);

  useEffect(() => {
    if (!selected) { setAlerts([]); return; }
    const alertUrl = `/api/alerts?from=${fromDate}&to=${toDate}&employee=${encodeURIComponent(selected.full_name)}`;
    fetch(alertUrl)
      .then(response=>response.json())
      .then(data=>setAlerts(data.alerts || []))
      .catch(()=>setAlerts([]));
  }, [fromDate, toDate, selected, punchRefresh]);

  const locations = useMemo(()=>['ALL',...[...new Set(employees.map(e=>e.location).filter(Boolean))].sort()],[employees]);
  const activeRulesByEmployee = useMemo(()=>{
    const map = new Map<string, EmployeeRule[]>();
    for (const rule of rules) {
      if (rule.active === false) continue;
      const keys = [rule.employee_id || '', normName(rule.employee_name || '')].filter(Boolean);
      for (const key of keys) map.set(key, [...(map.get(key) || []), rule]);
    }
    return map;
  }, [rules]);
  const ruleListFor = (employee: Employee | null) => {
    if (!employee) return [];
    const byId = employee.employee_id ? activeRulesByEmployee.get(employee.employee_id) || [] : [];
    const byName = activeRulesByEmployee.get(normName(employee.full_name)) || [];
    const seen = new Set<string>();
    return [...byId, ...byName].filter(rule => {
      const key = rule.id || `${rule.employee_name}:${rule.rule_type}:${rule.rule_value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const selectedRules = ruleListFor(selected);
  const filtered  = useMemo(()=>employees.filter(e=>{
    if (locFilter!=='ALL'&&e.location!==locFilter) return false;
    if (statusFilter==='ACTIVE'&&e.active===false) return false;
    if (statusFilter==='INACTIVE'&&e.active!==false) return false;
    if (statusFilter==='NEW'&&!e.is_new_this_month) return false;
    if (statusFilter==='MISSING'&&(e.location&&e.role&&Number(e.wage||0)>0)) return false;
    if (search&&!e.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }),[employees,locFilter,statusFilter,search]);
  const employeeSummary = useMemo(()=>({
    total:employees.length,
    active:employees.filter(employee=>employee.active!==false).length,
    inactive:employees.filter(employee=>employee.active===false).length,
    newThisMonth:employees.filter(employee=>employee.is_new_this_month).length,
    missingDetails:employees.filter(employee=>!employee.location || !employee.role || Number(employee.wage||0)<=0).length,
  }),[employees]);
  const employeePageCount = Math.max(1, Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE));
  const visibleEmployees = filtered.slice(employeePage * EMPLOYEE_PAGE_SIZE, (employeePage + 1) * EMPLOYEE_PAGE_SIZE);
  useEffect(()=>setEmployeePage(0),[search,locFilter,statusFilter,employees.length]);

  const completedPunches = punches.filter(p=>p.clocked_out);
  // Actual hours are the full clock-in/out duration. Payroll hours deduct only
  // unpaid breaks; total break time includes both paid and unpaid breaks.
  const actualHours = completedPunches.reduce((sum,p)=>sum+Number(p.gross_hours||0),0);
  const payrollHours = completedPunches.reduce((sum,p)=>sum+Number(p.payroll_hours||0),0);
  const totalBreakMinutes = completedPunches.reduce((sum,p)=>sum+Number(p.break_minutes||0),0);
  const workedLocations = Object.entries(completedPunches.reduce<Record<string,{actual:number;payroll:number;breakMinutes:number}>>((map,p)=>{
    const location=p.location||'Unknown';const payroll=Number(p.payroll_hours||p.hours||0);const actual=Number(p.gross_hours||0)||payroll;
    const row=map[location]||{actual:0,payroll:0,breakMinutes:0};row.actual+=actual;row.payroll+=payroll;row.breakMinutes+=Number(p.break_minutes||0);map[location]=row;return map;
  },{})).sort((a,b)=>b[1].actual-a[1].actual);
  const estPay = punches.filter(p=>p.clocked_out).reduce((sum,p)=>{
    const hours=Number(p.payroll_hours||0);
    return sum + hours * Number(p.wage || 0);
  },0);
  const cashRates = [...new Set(completedPunches.map(p=>Number(p.cash_wage||0)).filter(rate=>rate>0).map(rate=>rate.toFixed(2)))];
  const cashRateLabel = cashRates.length === 0 ? '—' : cashRates.length === 1 ? `$${cashRates[0]}/hr` : 'Multiple';
  const selectedRule = selectedRules[0];
  const selectedStatus = selected?.active === false ? 'Inactive' : 'Active';

  const refreshEmployees = async () => {
    invalidateClientCache(['/api/employees?active=all']);
    const data = await cachedJson<{employees:Employee[]}>('/api/employees?active=all', 0);
    setEmployees((data.employees || []).sort((a,b)=>a.full_name.localeCompare(b.full_name)));
  };

  const terminateSelected = async () => {
    if (!selected) return;
    const ok = window.confirm(`Mark ${selected.full_name} as inactive/terminated? This does not delete payroll history.`);
    if (!ok) return;
    setEmployeeMessage('');
    const response = await fetch('/api/employees', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:selected.id }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) { setEmployeeMessage(`Terminate failed: ${result.error || response.status}`); return; }
    setEmployeeMessage(`${selected.full_name} marked inactive.`);
    setSelected({...selected, active:false, status:'Inactive'});
    await refreshEmployees();
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (selected.active !== false) { setEmployeeMessage('Only inactive employees can be deleted. Terminate first.'); return; }
    const ok = window.confirm(`Delete inactive employee ${selected.full_name} from employee management? Historical punches/payroll rows stay saved.`);
    if (!ok) return;
    setEmployeeMessage('');
    const response = await fetch('/api/employees?hard=true', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:selected.id, hard:true }) });
    const result = await response.json();
    if (!response.ok || result.ok === false) { setEmployeeMessage(`Delete failed: ${result.error || response.status}`); return; }
    setEmployeeMessage(`${selected.full_name} deleted from employee management.`);
    setSelected(null);
    await refreshEmployees();
  };

  const syncSelectedPeriod = async () => {
    if (!selected || periodSyncing) return;
    setPeriodSyncing(true);
    setPeriodSyncMessage('');
    try {
      const response = await fetch('/api/7shifts/sync', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          start:`${fromDate}T00:00:00.000Z`,
          end:`${toDate}T23:59:59.999Z`,
          triggered_by:'logbook-period',
          sync_wages:true,
        }),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || '7shifts sync failed');
      const url=`/api/employees/${selected.seven_shifts_user_id||selected.id}/punches?from=${fromDate}&to=${toDate}`;
      invalidateClientCache([url, '/api/payroll']);
      setPunchRefresh(value=>value+1);
      setPeriodSyncMessage(`Updated ${result.synced?.punches || 0} punches and breaks`);
    } catch (error:any) {
      setPeriodSyncMessage(`Update failed: ${error.message}`);
    } finally {
      setPeriodSyncing(false);
    }
  };

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
      [`Location: ${selected.location||'—'} | Role: ${selected.role||'—'} | Cheque Wage: $${selected.wage}/hr | Cash Wage: ${cashRateLabel}`],
      [`Payroll rule: ${selectedRule ? `${selectedRule.rule_type}${selectedRule.rule_value !== undefined && selectedRule.rule_value !== null ? ` (${selectedRule.rule_value})` : ''}${selectedRule.notes ? ` — ${selectedRule.notes}` : ''}` : 'None'}`],
      [`Worked locations: ${workedLocations.map(([location,hours])=>`${location} (actual ${hours.actual.toFixed(2)}h, breaks ${(hours.breakMinutes/60).toFixed(2)}h, payroll ${hours.payroll.toFixed(2)}h)`).join('; ')||'—'}`],
      [`Period: ${fromDate} to ${toDate}`],
      [],
      ['Date','Clock In','Clock Out','Break (min)','Actual Hours','Payroll Hours','Location','Role','Source','Cheque Wage','Cash Wage','Cheque Pay','Cash Pay'],
      ...[...punches].sort((a,b)=>new Date(b.clocked_in).getTime()-new Date(a.clocked_in).getTime()).map(p=>{
        const ph = Number(p.payroll_hours||0);
        return [
          fmtDate(p.clocked_in),
          fmtTime(p.clocked_in),
          p.clocked_out ? fmtTime(p.clocked_out) : 'Still In',
          p.break_minutes||0,
          Number(p.gross_hours||0).toFixed(2),
          ph.toFixed(2),
          p.location,
          p.role||p.department||'—',
          displayPunchSource(p),
          p.wage ? cad(Number(p.wage)) : '—',
          p.cash_wage ? cad(Number(p.cash_wage)) : '—',
          p.clocked_out&&p.wage ? cad(ph*p.wage) : '—',
          p.clocked_out&&p.cash_wage ? cad(ph*p.cash_wage) : '—',
        ];
      }),
      [],
      ['TOTAL','','',Math.round(totalBreakMinutes),actualHours.toFixed(2),payrollHours.toFixed(2),'','','','','',estPay?cad(estPay):'—',''],
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
      <div style={{width:315,borderRight:'1px solid rgba(255,255,255,0.07)',display:'flex',flexDirection:'column',height:'100vh',position:'sticky',top:0,flexShrink:0}}>
        <div style={{padding:'14px 12px 10px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
          <h1 style={{fontSize:14,fontWeight:700,color:'#f9fafb',margin:'0 0 4px'}}>Employee Management</h1>
          <div style={{fontSize:10,color:'#6b7280',marginBottom:10}}>All employees since Jan · active/inactive/new labels · wages/rules read-only</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:5,marginBottom:9}}>
            {[
              ['All',employeeSummary.total,'ALL','#22d3ee'],
              ['Active',employeeSummary.active,'ACTIVE','#34d399'],
              ['Inactive',employeeSummary.inactive,'INACTIVE','#f97316'],
              ['New',employeeSummary.newThisMonth,'NEW','#a78bfa'],
            ].map(([label,value,key,color])=>(
              <button key={String(key)} onClick={()=>setStatusFilter(String(key))} style={{textAlign:'left',borderRadius:8,padding:'7px 8px',cursor:'pointer',background:statusFilter===key?'rgba(34,211,238,.10)':'rgba(255,255,255,.035)',border:`1px solid ${statusFilter===key?'rgba(34,211,238,.32)':'rgba(255,255,255,.07)'}`}}>
                <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase'}}>{String(label)}</div>
                <div style={{fontSize:15,fontWeight:800,color:String(color)}}>{String(value)}</div>
              </button>
            ))}
          </div>
          <input placeholder="Search employee…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{...sel,width:'100%',boxSizing:'border-box',marginBottom:7}}/>
          {/* Location filter */}
          <select value={locFilter} onChange={e=>setLocFilter(e.target.value)}
            style={{...sel,width:'100%',boxSizing:'border-box',marginBottom:7}}>
            {locations.map(l=><option key={l}>{l}</option>)}
          </select>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            <button onClick={()=>setStatusFilter('MISSING')} style={{...sel,padding:'4px 7px',fontSize:10,color:statusFilter==='MISSING'?'#f87171':'#9ca3af'}}>Missing details ({employeeSummary.missingDetails})</button>
            <button onClick={()=>{setStatusFilter('ALL');setLocFilter('ALL');setSearch('');}} style={{...sel,padding:'4px 7px',fontSize:10}}>Reset</button>
          </div>
        </div>
        <div style={{overflowY:'auto',flex:1}}>
          {loading ? <div style={{color:'#6b7280',padding:16,textAlign:'center',fontSize:12}}>Loading…</div> :
            visibleEmployees.map(emp=>(
              <div key={emp.id} onClick={()=>loadPunches(emp)}
                style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid rgba(255,255,255,0.03)',
                  background:selected?.id===emp.id?'rgba(34,211,238,0.12)':emp.is_new?'rgba(34,211,238,.055)':'transparent',
                  borderLeft:selected?.id===emp.id?'2px solid #22d3ee':'2px solid transparent'}}>
                <div style={{fontWeight:500,fontSize:12,color:'#f9fafb',display:'flex',alignItems:'center',gap:5}}>
                  {emp.full_name}
                  {emp.active===false&&<span title={`Last payroll date: ${emp.last_payroll_date || 'No payroll since Jan'}`} style={{fontSize:9,background:'rgba(249,115,22,.16)',color:'#f97316',borderRadius:3,padding:'1px 4px'}}>INACTIVE</span>}
                  {emp.active!==false&&<span style={{fontSize:9,background:'rgba(52,211,153,.12)',color:'#34d399',borderRadius:3,padding:'1px 4px'}}>ACTIVE</span>}
                  {emp.is_new_this_month&&<span title={`First seen ${emp.first_seen_date || emp.created_at || 'this month'}`} style={{fontSize:9,background:'rgba(34,211,238,.18)',color:'#22d3ee',borderRadius:3,padding:'1px 4px'}}>NEW</span>}
                  {emp.detail_change_note&&<span title={emp.detail_change_note} style={{fontSize:9,background:'rgba(167,139,250,0.16)',color:'#a78bfa',borderRadius:3,padding:'1px 4px'}}>ROLE</span>}
                  {(!emp.wage||+emp.wage===0)&&<span style={{fontSize:9,background:'rgba(248,113,113,0.2)',color:'#f87171',borderRadius:3,padding:'1px 4px'}}>$0</span>}
                </div>
                <div style={{fontSize:10,color:'#4b5563',marginTop:1}}>{emp.location || 'No location'} · {emp.role||emp.department||'No role'}</div>
                <div style={{fontSize:10,color:'#34d399',marginTop:1}}>${(+emp.wage||0).toFixed(2)}/hr <span style={{color:'#6b7280'}}>· Last payroll {emp.last_payroll_date || '—'}</span></div>
              </div>
            ))
          }
        </div>
        <div style={{padding:'7px 12px',borderTop:'1px solid rgba(255,255,255,0.07)',fontSize:10,color:'#6b7280',display:'flex',alignItems:'center',gap:6}}>
          <span style={{flex:1}}>{filtered.length ? `${employeePage*EMPLOYEE_PAGE_SIZE+1}–${Math.min((employeePage+1)*EMPLOYEE_PAGE_SIZE,filtered.length)} of ${filtered.length}` : '0 employees'}</span>
          <button disabled={employeePage===0} onClick={()=>setEmployeePage(p=>Math.max(0,p-1))} style={{...sel,padding:'3px 7px',opacity:employeePage===0?0.4:1}}>‹</button>
          <button disabled={employeePage>=employeePageCount-1} onClick={()=>setEmployeePage(p=>Math.min(employeePageCount-1,p+1))} style={{...sel,padding:'3px 7px',opacity:employeePage>=employeePageCount-1?0.4:1}}>›</button>
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
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(34,211,238,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#22d3ee',flexShrink:0}}>
                  {selected.full_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                </div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:'#f9fafb',display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                    {selected.full_name}
                    <span style={{fontSize:10,background:selected.active===false?'rgba(249,115,22,.16)':'rgba(52,211,153,.12)',color:selected.active===false?'#f97316':'#34d399',borderRadius:999,padding:'2px 7px'}}>{selectedStatus}</span>
                    {selected.is_new_this_month&&<span title={`First seen ${selected.first_seen_date || selected.created_at || 'this month'}`} style={{fontSize:10,background:'rgba(34,211,238,.16)',color:'#22d3ee',borderRadius:999,padding:'2px 7px'}}>NEW THIS MONTH</span>}
                  </div>
                  <div style={{fontSize:11,color:'#6b7280',marginTop:2}}>{selected.location} · {selected.department} · {selected.role}</div>
                  {(!selected.wage||+selected.wage===0)&&<div style={{fontSize:10,color:'#f87171',marginTop:2}}>⚠ No wage set</div>}
                  {selected.wage_upgrade_note&&<div style={{fontSize:10,color:'#22d3ee',marginTop:3}}>↗ {selected.wage_upgrade_note}</div>}
                  {selected.detail_change_note&&<div style={{fontSize:10,color:'#a78bfa',marginTop:3}}>↔ {selected.detail_change_note}</div>}
                </div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
                <button onClick={downloadExcel} disabled={punches.length===0} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:punches.length?'#34d399':'#4b5563',borderRadius:7,padding:'6px 14px',fontSize:12,cursor:punches.length?'pointer':'not-allowed',fontWeight:500,flexShrink:0}}>
                  ↓ Download Logbook CSV
                </button>
                {selected.active!==false ? (
                  <button onClick={terminateSelected} style={{background:'rgba(249,115,22,0.10)',border:'1px solid rgba(249,115,22,0.34)',color:'#f97316',borderRadius:7,padding:'6px 14px',fontSize:12,cursor:'pointer',fontWeight:600}}>
                    Terminate / Quit
                  </button>
                ) : (
                  <button onClick={deleteSelected} style={{background:'rgba(248,113,113,0.10)',border:'1px solid rgba(248,113,113,0.34)',color:'#f87171',borderRadius:7,padding:'6px 14px',fontSize:12,cursor:'pointer',fontWeight:600}}>
                    Delete inactive
                  </button>
                )}
              </div>
            </div>

            {employeeMessage&&<div style={{margin:'0 0 12px 50px',background:employeeMessage.includes('failed')||employeeMessage.includes('Only inactive')?'rgba(248,113,113,.09)':'rgba(52,211,153,.09)',border:`1px solid ${employeeMessage.includes('failed')||employeeMessage.includes('Only inactive')?'rgba(248,113,113,.25)':'rgba(52,211,153,.22)'}`,borderRadius:8,padding:'8px 10px',fontSize:11,color:employeeMessage.includes('failed')||employeeMessage.includes('Only inactive')?'#f87171':'#34d399'}}>{employeeMessage}</div>}

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:8,margin:'0 0 14px 50px'}}>
              {[
                {label:'Status',value:selectedStatus,color:selected.active===false?'#f97316':'#34d399'},
                {label:'First payroll / start',value:shortDate(selected.first_payroll_date || selected.first_seen_date || selected.created_at),color:'#22d3ee'},
                {label:'Last payroll date',value:shortDate(selected.last_payroll_date),color:selected.active===false?'#f97316':'#9ca3af'},
                {label:'Payroll hrs since Jan',value:`${Number(selected.payroll_hours_since_jan || 0).toFixed(2)}h`,color:'#a78bfa'},
                {label:'Cheque wage',value:`$${(+selected.wage||0).toFixed(2)}/hr`,color:'#34d399'},
                {label:'Cash wage',value:selected.cash_wage?`$${(+selected.cash_wage).toFixed(2)}/hr`:'—',color:'#fbbf24'},
                {label:'7shifts ID',value:selected.seven_shifts_user_id || '—',color:'#9ca3af'},
                {label:'Wage source',value:selected.wage_source || '—',color:'#9ca3af'},
              ].map(card=>(
                <div key={card.label} style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:9,padding:'9px 11px'}}>
                  <div style={{fontSize:9,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em'}}>{card.label}</div>
                  <div style={{fontSize:13,fontWeight:800,color:card.color,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={String(card.value)}>{card.value}</div>
                </div>
              ))}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10,margin:'0 0 14px 50px'}}>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'11px 12px'}}>
                <div style={{fontSize:11,fontWeight:800,color:'#f9fafb',marginBottom:7}}>Employee details from 7shifts / payroll</div>
                <div style={{display:'grid',gap:5,fontSize:11,color:'#9ca3af'}}>
                  <div><span style={{color:'#6b7280'}}>Primary location:</span> {selected.location || 'No location'}</div>
                  <div><span style={{color:'#6b7280'}}>Department:</span> {selected.department || 'No department'}</div>
                  <div><span style={{color:'#6b7280'}}>Role:</span> {selected.role || 'No role'}</div>
                  <div><span style={{color:'#6b7280'}}>Worked locations since Jan:</span> {(selected.worked_locations_since_jan || []).join(', ') || '—'}</div>
                  {selected.active===false&&<div style={{color:'#f97316'}}><span style={{color:'#6b7280'}}>Inactive from:</span> last payroll {shortDate(selected.last_payroll_date)}</div>}
                </div>
              </div>
              <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'11px 12px'}}>
                <div style={{fontSize:11,fontWeight:800,color:'#f9fafb',marginBottom:7}}>Read-only wages & rules</div>
                <div style={{fontSize:10,color:'#6b7280',marginBottom:7}}>Edit wages and payroll rules only in the Wages tab. This page is for employee management.</div>
                <div style={{display:'grid',gap:6}}>
                  {selectedRules.length===0 ? <div style={{fontSize:11,color:'#9ca3af'}}>No special payroll rules</div> : selectedRules.map(rule=>(
                    <div key={rule.id || `${rule.employee_name}-${rule.rule_type}`} style={{background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.18)',borderRadius:7,padding:'6px 8px',fontSize:11,color:'#d8b4fe'}}>
                      <span style={{fontWeight:800}}>{rule.rule_type.replaceAll('_',' ')}</span>
                      {rule.rule_value !== undefined && rule.rule_value !== null ? ` · Value ${rule.rule_value}` : ''}
                      {rule.combined_locations ? ` · Combined: ${rule.combined_locations}` : ''}
                      {rule.payroll_location ? ` · Payroll location: ${rule.payroll_location}` : ''}
                      {rule.notes ? <span style={{color:'#9ca3af'}}> · {rule.notes}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {workedLocations.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',margin:'-8px 0 14px 50px'}}>{workedLocations.map(([location,hours])=><span key={location} style={{fontSize:10,color:'#22d3ee',background:'rgba(34,211,238,.08)',border:'1px solid rgba(34,211,238,.16)',borderRadius:5,padding:'3px 7px'}}>{location}: {hours.actual.toFixed(2)} actual · {(hours.breakMinutes/60).toFixed(2)} break · {hours.payroll.toFixed(2)} payroll</span>)}</div>}

            {alerts.length>0&&(
              <div style={{margin:'-4px 0 14px 50px',background:'rgba(251,191,36,.08)',border:'1px solid rgba(251,191,36,.24)',borderRadius:10,padding:'10px 12px'}}>
                <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginBottom:6}}>⚠ Saved logbook alerts for this period</div>
                <div style={{display:'grid',gap:5}}>
                  {alerts.map(alert=>(
                    <div key={alert.id} style={{fontSize:11,color:'#e5e7eb',lineHeight:1.35}}>
                      <span style={{color:alert.severity==='critical'?'#f87171':'#fbbf24',fontWeight:700}}>{alert.alert_date} · {alert.type.replaceAll('_',' ')}</span>
                      <span style={{color:'#9ca3af'}}> · {alert.location || 'Unknown'} · </span>
                      {alert.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Date range controls */}
            <div style={{background:'#131720',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:9}}>
                <select aria-label="Logbook year" value={filterYear} onChange={e=>applyMonthPeriod(Number(e.target.value),filterMonth,filterPeriod==='custom'?'month':filterPeriod)} style={sel}>
                  {[2024,2025,2026,2027].map(year=><option key={year}>{year}</option>)}
                </select>
                <select aria-label="Logbook month" value={filterMonth} onChange={e=>applyMonthPeriod(filterYear,Number(e.target.value),filterPeriod==='custom'?'month':filterPeriod)} style={sel}>
                  {MONTHS.map((name,index)=><option key={name} value={index+1}>{name}</option>)}
                </select>
                <select aria-label="Logbook pay period" value={filterPeriod==='custom'?'month':filterPeriod} onChange={e=>applyMonthPeriod(filterYear,filterMonth,e.target.value)} style={sel}>
                  <option value="month">Full month</option>
                  <option value="1-15">1–15</option>
                  <option value="16-end">16–End</option>
                </select>
              </div>
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
                <button onClick={()=>{
                  const url=`/api/employees/${selected.seven_shifts_user_id||selected.id}/punches?from=${fromDate}&to=${toDate}`;
                  invalidateClientCache([url]);
                  setPunchRefresh(value=>value+1);
                }} style={{background:'rgba(34,211,238,0.1)',border:'1px solid rgba(34,211,238,0.3)',color:'#22d3ee',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer'}}>
                  Apply →
                </button>
                <button onClick={syncSelectedPeriod} disabled={periodSyncing} style={{background:'rgba(52,211,153,0.1)',border:'1px solid rgba(52,211,153,0.3)',color:periodSyncing?'#6b7280':'#34d399',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:periodSyncing?'wait':'pointer'}}>
                  {periodSyncing?'Updating 7shifts…':'↻ Update selected period'}
                </button>
              </div>
              {periodSyncMessage&&<div role="status" style={{fontSize:10,color:periodSyncMessage.startsWith('Updated')?'#34d399':'#f87171',marginTop:8}}>{periodSyncMessage}</div>}
            </div>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:8,marginBottom:16}}>
              {[
                {l:'Shifts',v:punches.length,c:'#22d3ee'},
                {l:'Actual Hours',v:`${actualHours.toFixed(2)}h`,c:'#60a5fa'},
                {l:'Payroll Hours',v:`${payrollHours.toFixed(2)}h`,c:'#a78bfa'},
                {l:'Break Time',v:`${Math.round(totalBreakMinutes)}m`,c:'#fbbf24'},
                {l:'Wage',v:`$${(+selected.wage||0).toFixed(2)}/hr`,c:'#34d399'},
                {l:'Cash Wage',v:cashRateLabel,c:'#fbbf24'},
                {l:'Est. Pay',v:estPay?`$${estPay.toFixed(0)}`:'—',c:'#fbbf24'},
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
              ) : punchError ? (
                <div style={{color:'#f87171',padding:24,textAlign:'center',fontSize:12}}>Unable to load punches: {punchError}</div>
              ) : punches.length===0 ? (
                <div style={{color:'#6b7280',padding:24,textAlign:'center',fontSize:12}}>No punches found for this period</div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:920}}>
                    <thead><tr style={{background:'rgba(0,0,0,0.2)'}}>
                      {['Date','Clock In','Clock Out','Break','Payroll Hrs','Gross Hrs','Location','Role','Source','Cheque Wage','Cash Wage','Pay'].map(h=>(
                        <th key={h} style={{padding:'7px 10px',textAlign:'left',color:'#6b7280',fontWeight:500,fontSize:9,textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {[...punches].sort((a,b)=>new Date(b.clocked_in).getTime()-new Date(a.clocked_in).getTime()).map((p,i)=>{
                        const ph = Number(p.payroll_hours||0);
                        const gh = +p.gross_hours||ph;
                        const isLive = !p.clocked_out;
                        const pay = ph*Number(p.wage||0);
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
                            <td style={{padding:'7px 10px',whiteSpace:'nowrap'}}>
                              <span style={{
                                display:'inline-flex',
                                alignItems:'center',
                                borderRadius:999,
                                padding:'2px 7px',
                                fontSize:10,
                                fontWeight:700,
                                color:isWebPunch(p)?'#fbbf24':'#22d3ee',
                                background:isWebPunch(p)?'rgba(251,191,36,0.12)':'rgba(34,211,238,0.09)',
                                border:`1px solid ${isWebPunch(p)?'rgba(251,191,36,0.25)':'rgba(34,211,238,0.18)'}`,
                              }}>
                                {displayPunchSource(p)}
                              </span>
                            </td>
                            <td style={{padding:'7px 10px',color:'#9ca3af',textAlign:'right'}}>{p.wage?cad(Number(p.wage)):'—'}</td>
                            <td style={{padding:'7px 10px',color:'#fbbf24',textAlign:'right'}}>{p.cash_wage?cad(Number(p.cash_wage)):'—'}</td>
                            <td style={{padding:'7px 10px',textAlign:'right',color:isLive?'#374151':'#34d399'}}>
                              {isLive?'—':(p.wage?cad(pay):'—')}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total row */}
                      <tr style={{borderTop:'2px solid rgba(255,255,255,0.1)',background:'rgba(34,211,238,0.04)'}}>
                        <td colSpan={4} style={{padding:'9px 10px',fontWeight:700,color:'#22d3ee',fontSize:12}}>Total (payroll-approved hours)</td>
                        <td style={{padding:'9px 10px',color:'#22d3ee',fontWeight:700,textAlign:'right'}}>{payrollHours.toFixed(2)}h</td>
                        <td/><td/><td/><td/><td/><td/>
                        <td style={{padding:'9px 10px',color:'#34d399',fontWeight:700,textAlign:'right'}}>{estPay?cad(estPay):'—'}</td>
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
