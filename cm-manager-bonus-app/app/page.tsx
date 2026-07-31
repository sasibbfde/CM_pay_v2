'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { rubricForManager } from '@/lib/manager-bonus';
import styles from './page.module.css';

type ManagerRow = {
  employee_id:string; employee_name:string; location:string; department:string; role:string; seven_shifts_hours:number; manual_hours:number; worked_hours:number;
  original_bonus:number; notes?:string; approval?:string; totalPoints:number; scorePercent:number; maxExtraBonus:number; earnedExtraBonus:number; finalBonus:number;
  rubric_ratings:Array<number|null>; bonus_pool:number; max_points:number; wage:number; archived_record?:boolean;
};

type ManagerBonusResponse = {
  rows?: ManagerRow[];
  locationScope?: string;
  sessionRole?: 'owner' | 'location_manager';
  error?: string;
};

type LoginAccount = {
  id:string;
  email:string;
  location:string;
  role:'owner'|'location_manager';
  builtin?:boolean;
  password?:string;
};

const currency = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0});
const rate = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',minimumFractionDigits:2,maximumFractionDigits:2});

function periodDates(month:string,period:string){
  const [year,number]=month.split('-').map(Number);
  const last=new Date(year,number,0).getDate();
  return { start:`${month}-${period==='16-end'?'16':'01'}`, end:`${month}-${String(period==='1-15'?15:last).padStart(2,'0')}` };
}

function monthValue(date:Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}

function periodLabel(period:string) {
  if (period === '1-15') return '1–15';
  if (period === '16-end') return '16–End';
  return 'Full month';
}

function monthLabel(month:string) {
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1).toLocaleDateString('en-CA', { month:'short', year:'numeric' });
}

function calculate(row:ManagerRow){
  const rubric_ratings = Array.isArray(row.rubric_ratings) ? [...row.rubric_ratings.slice(0,10), ...Array(Math.max(0, 10-row.rubric_ratings.length)).fill(null)] : Array(10).fill(null);
  const bonus_pool = Number(row.bonus_pool || 50);
  const max_points = Number(row.max_points || 50);
  const totalPoints = rubric_ratings.reduce<number>((sum,value)=>sum+(Number(value)||0),0);
  const scorePercent = totalPoints / max_points;
  const maxExtraBonus = Number(row.original_bonus||0) * (bonus_pool / 100);
  const earnedExtraBonus = maxExtraBonus * scorePercent;
  const worked_hours = Number(row.seven_shifts_hours||0) + Number(row.manual_hours||0);
  return {...row,wage:Number(row.wage||0),rubric_ratings,bonus_pool,max_points,totalPoints,scorePercent,maxExtraBonus,earnedExtraBonus,finalBonus:Number(row.original_bonus||0)+earnedExtraBonus,worked_hours};
}

function status(row:ManagerRow){
  if (!row.original_bonus) return 'none';
  return row.rubric_ratings.filter(value=>value!==null&&value!==undefined).length === 10 ? 'done' : 'part';
}

function statusText(value:string){
  if (value === 'done') return 'Done';
  if (value === 'part') return 'In progress';
  return 'Not started';
}

function money(value:number) {
  return currency.format(value || 0);
}

function Rating({value,onChange}:{value:number|null;onChange:(value:number|null)=>void}) {
  return <div className={styles.rating}>
    {[0,1,2,3,4,5].map(point => <button key={point} className={value===point?styles.on:value!==null&&value!==undefined&&point>0&&point<value?styles.lit:''} onClick={()=>onChange(point)}>{point}</button>)}
    <button className={styles.clear} title="Clear" onClick={()=>onChange(null)}>×</button>
  </div>;
}

export default function ManagerBonusApp() {
  const now = new Date();
  const [month,setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [period,setPeriod] = useState('month');
  const [location,setLocation] = useState('ALL');
  const [query,setQuery] = useState('');
  const [rows,setRows] = useState<ManagerRow[]>([]);
  const [selectedKey,setSelectedKey] = useState('');
  const [saving,setSaving] = useState('');
  const [message,setMessage] = useState('');
  const [loading,setLoading] = useState(true);
  const [refreshKey,setRefreshKey] = useState(0);
  const [locationScope,setLocationScope] = useState('');
  const [sessionRole,setSessionRole] = useState<'owner'|'location_manager'|''>('');
  const [activeTab,setActiveTab] = useState<'current'|'past'|'accounts'>('current');
  const [accounts,setAccounts] = useState<LoginAccount[]>([]);
  const [accountLocations,setAccountLocations] = useState<string[]>(['All locations']);
  const [accountsLoading,setAccountsLoading] = useState(false);
  const [accountsMessage,setAccountsMessage] = useState('');
  const dates = useMemo(()=>periodDates(month,period),[month,period]);
  const pastMonths = useMemo(()=>{
    const items:{month:string;label:string}[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset > -12; offset -= 1) {
      const value = monthValue(new Date(now.getFullYear(), now.getMonth() + offset, 1));
      if (seen.has(value)) continue;
      seen.add(value);
      items.push({ month:value, label:monthLabel(value) });
    }
    return items;
  },[]);

  useEffect(()=>{
    let active = true;
    setLoading(true);
    setMessage('');
    fetch(`/api/manager-bonus?start=${dates.start}&end=${dates.end}`)
      .then(async response=>{
        const data: ManagerBonusResponse = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load manager bonus data');
        if (active && data.sessionRole) setSessionRole(data.sessionRole);
        const scopedLocation = data.locationScope || '';
        if (active && scopedLocation) {
          setLocationScope(scopedLocation);
          setLocation(scopedLocation);
        }
        if (active) setRows((data.rows || []).map(calculate));
      })
      .catch(error=>active&&setMessage(error.message))
      .finally(()=>active&&setLoading(false));
    return()=>{active=false};
  },[dates.start,dates.end,refreshKey]);

  useEffect(()=>{
    if (activeTab !== 'accounts' || sessionRole !== 'owner') return;
    let active = true;
    setAccountsLoading(true);
    setAccountsMessage('');
    fetch('/api/location-accounts')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load login accounts');
        if (active) {
          setAccounts((data.accounts || []).map((account:LoginAccount) => ({ ...account, password:'' })));
          setAccountLocations(data.locations || ['All locations']);
        }
      })
      .catch(error => active && setAccountsMessage(error.message))
      .finally(() => active && setAccountsLoading(false));
    return () => { active = false; };
  },[activeTab,sessionRole]);

  const locations = useMemo(()=>[...new Set(rows.map(row=>row.location))].sort(),[rows]);
  const locationOptions = locationScope ? [locationScope] : locations;
  const visible = useMemo(()=>rows
    .filter(row=>(locationScope ? row.location === locationScope : location==='ALL'||row.location===location))
    .filter(row=>!query.trim()||row.employee_name.toLowerCase().includes(query.toLowerCase().trim())||row.location.toLowerCase().includes(query.toLowerCase().trim())),
    [rows,location,locationScope,query]);
  const selected = useMemo(()=>visible.find(row=>`${row.employee_id}\u0000${row.location}`===selectedKey) || visible[0] || null,[visible,selectedKey]);
  const totals = useMemo(()=>visible.reduce((sum,row)=>({
    managers:sum.managers+1,
    hours:sum.hours+row.worked_hours,
    original:sum.original+row.original_bonus,
    extra:sum.extra+row.earnedExtraBonus,
    final:sum.final+row.finalBonus,
    done:sum.done+(status(row)==='done'?1:0),
    archived:sum.archived+(row.archived_record?1:0),
    withHours:sum.withHours+(row.seven_shifts_hours>0?1:0),
  }),{managers:0,hours:0,original:0,extra:0,final:0,done:0,archived:0,withHours:0}),[visible]);

  function keyFor(row:ManagerRow) {
    return `${row.employee_id}\u0000${row.location}`;
  }

  function update(field:keyof ManagerRow,value:any) {
    if (!selected) return;
    const key = keyFor(selected);
    setRows(current=>current.map(row=>keyFor(row)===key?calculate({...row,[field]:value}):row));
  }

  function updateRating(index:number,value:number|null) {
    if (!selected) return;
    const key = keyFor(selected);
    setRows(current=>current.map(row=>{
      if (keyFor(row)!==key) return row;
      const rubric_ratings = [...row.rubric_ratings];
      rubric_ratings[index] = value;
      return calculate({...row,rubric_ratings});
    }));
  }

  async function saveReview() {
    if (!selected) return;
    const key = keyFor(selected);
    setSaving(key);
    setMessage('');
    try {
      const response = await fetch('/api/manager-bonus', {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...selected,period_start:dates.start,period_end:dates.end}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setMessage(`Saved ${selected.employee_name} — ${selected.location}`);
    } catch (error:any) {
      setMessage(error.message);
    } finally {
      setSaving('');
    }
  }

  async function signOut() {
    await fetch('/api/location-login', { method:'DELETE' }).catch(()=>null);
    await createClient().auth.signOut();
    window.location.assign('/login');
  }

  function updateAccount(id:string, field:'email'|'password'|'location'|'role', value:string) {
    setAccounts(current => current.map(account => account.id === id ? { ...account, [field]:value } : account));
  }

  function addAccount() {
    setAccounts(current => [
      ...current,
      {
        id:`custom:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        email:'',
        location:accountLocations[0] || 'All locations',
        role:'location_manager',
        builtin:false,
        password:'',
      },
    ]);
    setAccountsMessage('Added a new login. Choose All locations or one location, then enter username/email and password.');
  }

  function addOwnerAccount(email = '') {
    setAccounts(current => {
      const normalized = email.trim().toLowerCase();
      if (normalized && current.some(account => account.email.toLowerCase() === normalized)) return current;
      return [
        ...current,
        {
          id:`custom-owner:${Date.now()}:${Math.random().toString(16).slice(2)}`,
          email:normalized,
          location:'All locations',
          role:'owner',
          builtin:false,
          password:'',
        },
      ];
    });
    setAccountsMessage('Added an Owner/Admin login. Enter a password with at least 8 characters, then Save accounts.');
  }

  function deleteAccount(id:string) {
    const account = accounts.find(item => item.id === id);
    if (account?.role === 'owner') {
      setAccountsMessage('Owner login cannot be deleted.');
      return;
    }
    if (account?.builtin) {
      setAccountsMessage('Built-in location logins stay available for safety. You can edit username/password or add custom users.');
      return;
    }
    setAccounts(current => current.filter(item => item.id !== id));
    setAccountsMessage('Login removed. Click Save accounts to make it permanent.');
  }

  async function saveAccounts() {
    setAccountsLoading(true);
    setAccountsMessage('');
    try {
      const response = await fetch('/api/location-accounts', {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ accounts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save login accounts');
      setAccounts((data.accounts || []).map((account:LoginAccount) => ({ ...account, password:'' })));
      setAccountsMessage('Saved login accounts. Share the new email/password with the manager.');
    } catch (error:any) {
      setAccountsMessage(error.message);
    } finally {
      setAccountsLoading(false);
    }
  }

  async function copyAccount(account:LoginAccount) {
    const password = account.password?.trim();
    const text = `Manager Bonus login\nRole: ${account.role === 'owner' ? 'Owner/Admin' : 'Location user'}\nAccess: ${account.role === 'owner' ? 'All locations' : account.location}\nUsername/email: ${account.email}${password ? `\nPassword: ${password}` : '\nPassword: set/reset password before sharing'}\nApp: https://cm-manager-bonus.vercel.app`;
    await navigator.clipboard?.writeText(text).catch(()=>null);
    setAccountsMessage(`Copied ${account.location} login details.`);
  }

  const rubric = selected ? rubricForManager(selected.department, selected.role) : [];
  const selectedStatus = selected ? status(selected) : 'none';

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.mark}>CM</div>
        <div><small>Owner Portal</small><h1>Manager Bonus</h1></div>
      </div>
      <button className={styles.signOut} onClick={signOut}>Sign out</button>
    </header>

    <section className={styles.hero}>
      <article className={styles.heroCard}>
        <span className={styles.eyebrow}>Chiang Mai Thai Dining</span>
        <h2>Review managers, score performance, and prepare bonus payouts.</h2>
        <p>Manager names, locations, roles, hourly rate, and hours come from CM Pay V2 after its 7shifts sync. Use Current Review for this period and Past Records to reopen older saved reviews.</p>
      </article>
      <article className={styles.actionCard}>
        <span>Final payout</span>
        <strong>{money(totals.final)}</strong>
        <div className={styles.buttonRow}>
          <button className={styles.secondary} onClick={()=>setRefreshKey(value=>value+1)}>Refresh from CM Pay</button>
          <button className={styles.primary} onClick={()=>window.location.href=`/api/manager-bonus/export?start=${dates.start}&end=${dates.end}${location==='ALL'?'':`&location=${encodeURIComponent(location)}`}`}>Export Excel</button>
          {selected && <button className={styles.secondary} onClick={()=>window.location.href=`/api/manager-bonus/export?start=${dates.start}&end=${dates.end}&employee_id=${encodeURIComponent(selected.employee_id)}&location=${encodeURIComponent(selected.location)}`}>Selected manager</button>}
        </div>
      </article>
    </section>

    <nav className={styles.appTabs} aria-label="Manager bonus sections">
      <button className={activeTab === 'current' ? styles.appTabActive : ''} onClick={()=>setActiveTab('current')}>Current Review</button>
      <button className={activeTab === 'past' ? styles.appTabActive : ''} onClick={()=>setActiveTab('past')}>Past Records</button>
      {sessionRole === 'owner' && <button className={activeTab === 'accounts' ? styles.appTabActive : ''} onClick={()=>setActiveTab('accounts')}>Login Accounts</button>}
    </nav>

    {activeTab === 'accounts' && <section className={styles.accountsPanel}>
      <div className={styles.historyHead}>
        <div>
          <span className={styles.eyebrow}>Owner only</span>
          <h3>Manager login accounts</h3>
          <p>Add users, choose one location or All locations, and reset passwords. Saved accounts can sign in immediately.</p>
        </div>
        <div className={styles.buttonRow}>
          <button className={styles.secondaryDark} disabled={accountsLoading} onClick={()=>addOwnerAccount('cheshasi1995@gmail.com')}>+ Cheshasi owner</button>
          <button className={styles.secondaryDark} disabled={accountsLoading} onClick={()=>addOwnerAccount()}>+ Owner/Admin</button>
          <button className={styles.secondaryDark} disabled={accountsLoading} onClick={addAccount}>+ Add user</button>
          <button className={styles.historyActive} disabled={accountsLoading} onClick={saveAccounts}>{accountsLoading ? 'Saving…' : 'Save accounts'}</button>
        </div>
      </div>
      <p className={styles.helpNote}>Passwords are saved permanently as secure hashes. New users and password resets must use at least 8 characters. After saving, that username/email and password can sign in to this Manager Bonus app.</p>
      {accountsMessage && <p className={styles.status}>{accountsMessage}</p>}
      <div className={styles.accountsGrid}>
        {accounts.map(account => <article className={styles.accountCard} key={account.id}>
          <div>
            <strong>{account.role === 'owner' ? 'Owner / Admin' : account.location}</strong>
            <small>{account.role === 'owner' ? 'Can manage accounts and see all locations' : account.location === 'All locations' ? 'Can view all locations, cannot manage accounts' : 'Location manager access'}{account.builtin ? ' · built-in' : ' · custom'}</small>
          </div>
          {!account.builtin && <label className={styles.field}>Role<select value={account.role} onChange={event=>updateAccount(account.id,'role',event.target.value)}>
            <option value="location_manager">Location user</option>
            <option value="owner">Owner / Admin</option>
          </select></label>}
          {account.role !== 'owner' && <label className={styles.field}>Access<select value={account.location} onChange={event=>updateAccount(account.id,'location',event.target.value)}>
            {accountLocations.map(item=><option key={item} value={item}>{item}</option>)}
          </select></label>}
          <label className={styles.field}>Username / email<input value={account.email} onChange={event=>updateAccount(account.id,'email',event.target.value)} /></label>
          <label className={styles.field}>New password <span className={styles.requiredHint}>8+ characters</span><input type="text" value={account.password || ''} onChange={event=>updateAccount(account.id,'password',event.target.value)} placeholder={account.builtin ? 'Leave blank to keep current password' : 'Required for new user'} /></label>
          <div className={styles.accountActions}>
            <button className={styles.secondaryDark} onClick={()=>copyAccount(account)}>Copy details</button>
            {account.role !== 'owner' && !account.builtin && <button className={styles.dangerButton} onClick={()=>deleteAccount(account.id)}>Delete</button>}
          </div>
        </article>)}
      </div>
    </section>}

    {activeTab !== 'accounts' && <>
    {activeTab === 'past' && <section className={styles.historyPanel}>
      <div className={styles.historyHead}>
        <div>
          <span className={styles.eyebrow}>Past records</span>
          <h3>{monthLabel(month)} · {periodLabel(period)}</h3>
          <p>{dates.start} → {dates.end} · choose a month here, then use Payroll filter below for Full month, 1–15, or 16–End.</p>
        </div>
        <button className={styles.historyActive} onClick={()=>setRefreshKey(value=>value+1)}>Reload this period</button>
      </div>
      <div className={styles.periodStrip}>
        {pastMonths.map(item => {
          const active = item.month === month;
          const itemDates = periodDates(item.month, period);
          return <button key={item.month} className={active ? styles.periodActive : ''} onClick={() => { setMonth(item.month); setSelectedKey(''); }}>
            <strong>{item.label}</strong>
            <small>{itemDates.start} → {itemDates.end}</small>
          </button>;
        })}
      </div>
    </section>}

    <section className={styles.filters}>
      <label>Month<input type="month" value={month} onChange={event=>setMonth(event.target.value)} /></label>
      <label>Payroll filter<select value={period} onChange={event=>setPeriod(event.target.value)}><option value="month">Full month</option><option value="1-15">1–15</option><option value="16-end">16–End</option></select></label>
      <label>Location<select value={location} disabled={Boolean(locationScope)} onChange={event=>{setLocation(event.target.value);setSelectedKey('')}}>{!locationScope && <option value="ALL">All locations</option>}{locationOptions.map(item=><option key={item}>{item}</option>)}</select></label>
      <label>Search<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Manager or location" /></label>
    </section>

    {message && <p className={styles.status}>{message}</p>}

    <section className={styles.metrics}>
      <article className={styles.metric}><span>Managers</span><strong>{totals.managers}</strong></article>
      <article className={styles.metric}><span>Manager hours</span><strong>{totals.hours.toFixed(1)}h</strong></article>
      <article className={styles.metric}><span>Original bonus</span><strong>{money(totals.original)}</strong></article>
      <article className={styles.metric}><span>Earned extra</span><strong>{money(totals.extra)}</strong></article>
      <article className={styles.metric}><span>Reviews done</span><strong>{totals.done}/{totals.managers}</strong></article>
    </section>

    {loading ? <div className={styles.empty}>Loading manager hours…</div> : !selected ? <div className={styles.empty}>No managers found for this selection.</div> : <section className={styles.workspace}>
      <aside className={styles.managerList}>
        <div className={styles.panelHeader}><div><h3>Managers</h3><small>{dates.start} → {dates.end}</small></div></div>
        <div className={styles.search}><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search manager…" /></div>
        {visible.map(row=>{
          const rowKey = keyFor(row);
          const rowStatus = status(row);
          return <button key={rowKey} className={`${styles.person} ${rowKey===keyFor(selected)?styles.personActive:''}`} onClick={()=>setSelectedKey(rowKey)}>
            <span><strong>{row.employee_name}</strong><small>{row.location} · {row.role || row.department || 'Manager'} · {row.worked_hours.toFixed(1)}h</small></span>
            <i className={`${styles.pill} ${styles[rowStatus]}`}>{statusText(rowStatus)}</i>
          </button>;
        })}
      </aside>

      <article className={styles.reviewSheet}>
        <header className={styles.sheetHead}>
          <div><span className={styles.eyebrow}>Review sheet</span><h3>{selected.employee_name}</h3><p>{selected.location} · {selected.role || selected.department || 'Manager'} · {selected.archived_record ? 'Past saved record' : selectedStatus === 'done' ? 'Ready for payout' : statusText(selectedStatus)}</p></div>
          <div className={styles.payout}><small>Total bonus to pay</small><strong>{money(selected.finalBonus)}</strong></div>
        </header>
        <div className={styles.sheetBody}>
          <div className={styles.fields}>
            <label className={styles.field}>Hourly rate<input value={selected.wage ? `${rate.format(selected.wage)}/hr` : 'Not stored'} disabled /></label>
            <label className={styles.field}>7shifts hours<input value={selected.seven_shifts_hours.toFixed(2)} disabled /></label>
            <label className={styles.field}>Add hours<input type="number" step="0.25" value={selected.manual_hours || 0} onChange={event=>update('manual_hours',Number(event.target.value))} /></label>
            <label className={styles.field}>Original bonus<input type="number" min="0" step="0.01" value={selected.original_bonus || 0} onChange={event=>update('original_bonus',Number(event.target.value))} /></label>
            <label className={styles.field}>Bonus pool %<input type="number" min="0" max="100" step="1" value={selected.bonus_pool} onChange={event=>update('bonus_pool',Number(event.target.value))} /></label>
            <label className={styles.field}>Points possible<input type="number" min="1" step="1" value={selected.max_points} onChange={event=>update('max_points',Number(event.target.value))} /></label>
          </div>

          <div className={styles.rubric}>
            {rubric.map((item,index)=><div key={item.id} className={styles.rubricRow}>
              <div><strong>{index+1}. {item.label}</strong><p>{item.description}</p></div>
              <Rating value={selected.rubric_ratings[index] ?? null} onChange={value=>updateRating(index,value)} />
            </div>)}
          </div>

          <div className={styles.tally}>
            <div><span>Points</span><strong>{selected.totalPoints}/{selected.max_points}</strong></div>
            <div><span>Score</span><strong>{(selected.scorePercent*100).toFixed(1)}%</strong></div>
            <div><span>Max extra</span><strong>{money(selected.maxExtraBonus)}</strong></div>
            <div><span>Extra earned</span><strong>{money(selected.earnedExtraBonus)}</strong></div>
            <div><span>Final payout</span><strong>{money(selected.finalBonus)}</strong></div>
          </div>

          <div className={styles.notes}>
            <label className={styles.field}>Review notes<input value={selected.notes || ''} onChange={event=>update('notes',event.target.value)} placeholder="Notes for this manager" /></label>
            <label className={styles.field}>Approval<input value={selected.approval || ''} onChange={event=>update('approval',event.target.value)} placeholder="Approved by" /></label>
          </div>

          <div className={styles.actions}>
            <button className={styles.primary} disabled={saving===keyFor(selected)} onClick={saveReview}>{saving===keyFor(selected)?'Saving…':'Save review'}</button>
            <button className={styles.secondary} onClick={()=>window.location.href=`/api/manager-bonus/export?start=${dates.start}&end=${dates.end}&employee_id=${encodeURIComponent(selected.employee_id)}&location=${encodeURIComponent(selected.location)}`}>Download manager sheet</button>
          </div>
        </div>
      </article>
    </section>}
    </>}
  </main>;
}
