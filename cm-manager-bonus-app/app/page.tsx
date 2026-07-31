'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { rubricForManager } from '@/lib/manager-bonus';
import styles from './page.module.css';

type ManagerRow = {
  employee_id:string; employee_name:string; location:string; department:string; role:string; seven_shifts_hours:number; manual_hours:number; worked_hours:number;
  original_bonus:number; notes?:string; approval?:string; totalPoints:number; scorePercent:number; maxExtraBonus:number; earnedExtraBonus:number; finalBonus:number;
  rubric_ratings:Array<number|null>; bonus_pool:number; max_points:number;
};

const currency = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0});

function periodDates(month:string,period:string){
  const [year,number]=month.split('-').map(Number);
  const last=new Date(year,number,0).getDate();
  return { start:`${month}-${period==='16-end'?'16':'01'}`, end:`${month}-${String(period==='1-15'?15:last).padStart(2,'0')}` };
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
  return {...row,rubric_ratings,bonus_pool,max_points,totalPoints,scorePercent,maxExtraBonus,earnedExtraBonus,finalBonus:Number(row.original_bonus||0)+earnedExtraBonus,worked_hours};
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
  const dates = useMemo(()=>periodDates(month,period),[month,period]);

  useEffect(()=>{
    let active = true;
    setLoading(true);
    setMessage('');
    fetch(`/api/manager-bonus?start=${dates.start}&end=${dates.end}`)
      .then(async response=>{
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load manager bonus data');
        if (active) setRows((data.rows || []).map(calculate));
      })
      .catch(error=>active&&setMessage(error.message))
      .finally(()=>active&&setLoading(false));
    return()=>{active=false};
  },[dates.start,dates.end]);

  const locations = useMemo(()=>[...new Set(rows.map(row=>row.location))].sort(),[rows]);
  const visible = useMemo(()=>rows
    .filter(row=>location==='ALL'||row.location===location)
    .filter(row=>!query.trim()||row.employee_name.toLowerCase().includes(query.toLowerCase().trim())||row.location.toLowerCase().includes(query.toLowerCase().trim())),
    [rows,location,query]);
  const selected = useMemo(()=>visible.find(row=>`${row.employee_id}\u0000${row.location}`===selectedKey) || visible[0] || null,[visible,selectedKey]);
  const totals = useMemo(()=>visible.reduce((sum,row)=>({
    managers:sum.managers+1,
    hours:sum.hours+row.worked_hours,
    original:sum.original+row.original_bonus,
    extra:sum.extra+row.earnedExtraBonus,
    final:sum.final+row.finalBonus,
    done:sum.done+(status(row)==='done'?1:0),
  }),{managers:0,hours:0,original:0,extra:0,final:0,done:0}),[visible]);

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
        <p>Manager hours come from the same synced CM Pay / 7shifts payroll data. Bonus reviews save back to the same records, but this app stays focused only on owner review work.</p>
      </article>
      <article className={styles.actionCard}>
        <span>Final payout</span>
        <strong>{money(totals.final)}</strong>
        <div className={styles.buttonRow}>
          <button className={styles.primary} onClick={()=>window.location.href=`/api/manager-bonus/export?start=${dates.start}&end=${dates.end}${location==='ALL'?'':`&location=${encodeURIComponent(location)}`}`}>Export Excel</button>
          {selected && <button className={styles.secondary} onClick={()=>window.location.href=`/api/manager-bonus/export?start=${dates.start}&end=${dates.end}&employee_id=${encodeURIComponent(selected.employee_id)}&location=${encodeURIComponent(selected.location)}`}>Selected manager</button>}
        </div>
      </article>
    </section>

    <section className={styles.filters}>
      <label>Month<input type="month" value={month} onChange={event=>setMonth(event.target.value)} /></label>
      <label>Payroll filter<select value={period} onChange={event=>setPeriod(event.target.value)}><option value="month">Full month</option><option value="1-15">1–15</option><option value="16-end">16–End</option></select></label>
      <label>Location<select value={location} onChange={event=>{setLocation(event.target.value);setSelectedKey('')}}><option value="ALL">All locations</option>{locations.map(item=><option key={item}>{item}</option>)}</select></label>
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
          <div><span className={styles.eyebrow}>Review sheet</span><h3>{selected.employee_name}</h3><p>{selected.location} · {selected.role || selected.department || 'Manager'} · {selectedStatus === 'done' ? 'Ready for payout' : statusText(selectedStatus)}</p></div>
          <div className={styles.payout}><small>Total bonus to pay</small><strong>{money(selected.finalBonus)}</strong></div>
        </header>
        <div className={styles.sheetBody}>
          <div className={styles.fields}>
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
  </main>;
}
