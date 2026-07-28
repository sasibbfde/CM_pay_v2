'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './manager-bonus.module.css';

type ManagerRow = {
  employee_id:string; employee_name:string; location:string; department:string; role:string; seven_shifts_hours:number; manual_hours:number; worked_hours:number;
  original_bonus:number; attendance:number|null; inventory:number|null; cleaning:number|null; labour_control:number|null;
  customer_service_leadership:number|null; notes?:string; approval?:string; totalPoints:number; scorePercent:number;
  maxExtraBonus:number; earnedExtraBonus:number; finalBonus:number;
};

const categories = [
  ['Attendance & Reliability','attendance','Punctuality, attendance, schedule adherence, and accountability.'],
  ['Inventory Control','inventory','Ordering, par levels, waste control, smallwares, and follow-up on variances.'],
  ['Cleanliness Standards','cleaning','Dining room, kitchen, washrooms, storage, and health inspection readiness.'],
  ['Labour & Scheduling','labour_control','Labour optimization, schedule control, and keeping costs aligned to the forecast.'],
  ['Guest Experience & Leadership','customer_service_leadership','Floor presence, problem solving, coaching, team development, and guest recovery.'],
] as const;

const currency = new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'});
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function periodDates(month:string,period:string){
  const [year,number]=month.split('-').map(Number);
  const last=new Date(year,number,0).getDate();
  return {
    start:`${month}-${period==='16-end'?'16':'01'}`,
    end:`${month}-${String(period==='1-15'?15:last).padStart(2,'0')}`,
  };
}

function calculate(row:ManagerRow){
  const totalPoints=categories.reduce((sum,[,key])=>sum+(Number(row[key])||0),0);
  const scorePercent=totalPoints/25;
  const maxExtraBonus=Number(row.original_bonus||0)*.5;
  const earnedExtraBonus=maxExtraBonus*scorePercent;
  const worked_hours=Number(row.seven_shifts_hours||0)+Number(row.manual_hours||0);
  return {...row,worked_hours,totalPoints,scorePercent,maxExtraBonus,earnedExtraBonus,finalBonus:Number(row.original_bonus||0)+earnedExtraBonus};
}

function monthLabel(value:string){
  const [year,month]=value.split('-').map(Number);
  return `${months[month-1]} ${year}`;
}

function pct(value:number|null|undefined){
  return value===null||value===undefined||Number.isNaN(value) ? '—' : `${(value*100).toFixed(1)}%`;
}

function status(row:ManagerRow){
  if (!row.original_bonus) return 'none';
  const rated = categories.filter(([,key]) => row[key] !== null && row[key] !== undefined).length;
  return rated === categories.length ? 'done' : 'part';
}

function statusText(value:string){
  if (value === 'done') return 'Done';
  if (value === 'part') return 'Ratings incomplete';
  return 'Not started';
}

function RatingRail({value,onChange}:{value:number|null;onChange:(value:number|null)=>void}){
  return <div className={styles.ratingRail}>
    {[0,1,2,3,4,5].map(point => (
      <button
        key={point}
        type="button"
        aria-pressed={value===point}
        className={value===point ? styles.ratingOn : value !== null && value !== undefined && point > 0 && point < value ? styles.ratingLit : ''}
        onClick={()=>onChange(point)}
      >
        {point}
      </button>
    ))}
    <button type="button" className={styles.clearRating} title="Clear rating" onClick={()=>onChange(null)}>×</button>
  </div>;
}

export default function ManagerBonusPage(){
  const now=new Date();
  const [month,setMonth]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [period,setPeriod]=useState('month');
  const [location,setLocation]=useState('ALL');
  const [rows,setRows]=useState<ManagerRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState('');
  const [selectedKey,setSelectedKey]=useState('');
  const [view,setView]=useState<'dashboard'|'review'|'summary'|'guide'>('dashboard');
  const dates=useMemo(()=>periodDates(month,period),[month,period]);

  useEffect(()=>{
    let active=true;
    setLoading(true);
    setMessage('');
    fetch(`/api/manager-bonus?start=${dates.start}&end=${dates.end}`)
      .then(async response=>{
        const data=await response.json();
        if(!response.ok) throw new Error(data.error||'Unable to load manager bonuses');
        if(active) setRows((data.rows||[]).map(calculate));
      })
      .catch(error=>active&&setMessage(error.message))
      .finally(()=>active&&setLoading(false));
    return()=>{active=false};
  },[dates.start,dates.end]);

  const locations=useMemo(()=>[...new Set(rows.map(row=>row.location))].sort(),[rows]);
  const visible=useMemo(()=>location==='ALL'?rows:rows.filter(row=>row.location===location),[rows,location]);
  const selected=useMemo(()=>{
    const found = visible.find(row=>`${row.employee_id}\u0000${row.location}`===selectedKey);
    return found || visible[0] || null;
  },[visible,selectedKey]);
  const totals=useMemo(()=>visible.reduce((sum,row)=>({
    hours:sum.hours+row.worked_hours,
    seven:sum.seven+row.seven_shifts_hours,
    manual:sum.manual+row.manual_hours,
    original:sum.original+row.original_bonus,
    extra:sum.extra+row.earnedExtraBonus,
    final:sum.final+row.finalBonus,
    done:sum.done+(status(row)==='done'?1:0),
  }),{hours:0,seven:0,manual:0,original:0,extra:0,final:0,done:0}),[visible]);

  const locationSummary = useMemo(()=>{
    return locations.map(item=>{
      const locationRows=rows.filter(row=>row.location===item);
      return {
        location:item,
        managers:locationRows.length,
        hours:locationRows.reduce((sum,row)=>sum+row.worked_hours,0),
        final:locationRows.reduce((sum,row)=>sum+row.finalBonus,0),
        done:locationRows.filter(row=>status(row)==='done').length,
      };
    });
  },[locations,rows]);

  function update(indexKey:string,field:keyof ManagerRow,value:any){
    setRows(current=>current.map(row=>`${row.employee_id}\u0000${row.location}`===indexKey?calculate({...row,[field]:value}):row));
  }

  async function save(row:ManagerRow){
    const key=`${row.employee_id}\u0000${row.location}`;
    setSaving(key);
    setMessage('');
    try{
      const response=await fetch('/api/manager-bonus',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,period_start:dates.start,period_end:dates.end})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Save failed');
      setMessage(`Saved ${row.employee_name} — ${row.location}`);
    }catch(error:any){
      setMessage(error.message);
    }finally{
      setSaving('');
    }
  }

  function exportUrl(extra=''){
    return `/api/manager-bonus/export?start=${dates.start}&end=${dates.end}${extra}`;
  }

  function selectedKeyFor(row:ManagerRow){
    return `${row.employee_id}\u0000${row.location}`;
  }

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div>
        <div className={styles.kicker}>Chiang Mai Thai Dining</div>
        <h1>Manager Bonus Plan</h1>
        <p>Monthly manager reviews using 7shifts manager hours, manual hour adjustments, five 0–5 scoring areas, and a 50% prorated extra-bonus pool.</p>
      </div>
      <div className={styles.heroActions}>
        <button className={styles.secondaryButton} onClick={()=>window.location.href=exportUrl(location==='ALL'?'':`&location=${encodeURIComponent(location)}`)}>↓ Export {location==='ALL'?'all locations':location}</button>
        {selected && <button className={styles.primaryButton} onClick={()=>window.location.href=exportUrl(`&employee_id=${encodeURIComponent(selected.employee_id)}&location=${encodeURIComponent(selected.location)}`)}>Download selected</button>}
      </div>
    </section>

    <section className={styles.monthStrip} aria-label="Manager bonus month">
      {Array.from({length:12},(_,index)=>{
        const value=`${month.slice(0,4)}-${String(index+1).padStart(2,'0')}`;
        const current=value===month;
        return <button key={value} className={current?styles.currentMonth:''} onClick={()=>setMonth(value)}>
          <span>{months[index]}</span>
          <small>{month.slice(0,4)}</small>
          <i />
        </button>;
      })}
    </section>

    <section className={styles.controls}>
      <label>Year / Month <input type="month" value={month} onChange={event=>setMonth(event.target.value)} /></label>
      <label>Payroll period <select value={period} onChange={event=>setPeriod(event.target.value)}><option value="month">Full month</option><option value="1-15">1–15</option><option value="16-end">16–End</option></select></label>
      <label>Location <select value={location} onChange={event=>{setLocation(event.target.value);setSelectedKey('')}}><option value="ALL">All locations</option>{locations.map(item=><option key={item}>{item}</option>)}</select></label>
      <span>{dates.start} → {dates.end}</span>
    </section>

    <nav className={styles.subnav}>
      {[
        ['dashboard','Dashboard'],
        ['review','Reviews'],
        ['summary','Location summary'],
        ['guide','Rating guide'],
      ].map(([key,label])=><button key={key} className={view===key?styles.activeSubnav:''} onClick={()=>setView(key as any)}>{label}</button>)}
    </nav>

    {message && <div className={message.startsWith('Saved')?styles.success:styles.error}>{message}</div>}

    <section className={styles.cards}>
      <article className={`${styles.card} ${styles.accentCard}`}><span>Final payout</span><strong>{currency.format(totals.final)}</strong><small>{monthLabel(month)} · {visible.length} manager rows</small></article>
      <article className={styles.card}><span>Manager hours</span><strong>{totals.hours.toFixed(1)}h</strong><small>{totals.seven.toFixed(1)}h from 7shifts · {totals.manual.toFixed(1)}h manual</small></article>
      <article className={styles.card}><span>Original bonus</span><strong>{currency.format(totals.original)}</strong><small>Saved base amounts</small></article>
      <article className={styles.card}><span>Earned extra</span><strong>{currency.format(totals.extra)}</strong><small>50% pool × review score</small></article>
      <article className={styles.card}><span>Finished reviews</span><strong>{totals.done}/{visible.length}</strong><small>{visible.length-totals.done} still open</small></article>
    </section>

    {loading ? <div className={styles.empty}>Loading manager bonus data…</div> : visible.length===0 ? <div className={styles.empty}>No managers found for this selection. Check manager roles in Wages/7shifts and sync again.</div> : <>
      {view === 'dashboard' && <Dashboard rows={visible} setView={setView} setSelectedKey={setSelectedKey} selectedKeyFor={selectedKeyFor} />}
      {view === 'review' && <Review rows={visible} selected={selected} selectedKeyFor={selectedKeyFor} setSelectedKey={setSelectedKey} update={update} save={save} saving={saving} datesLabel={monthLabel(month)} exportUrl={exportUrl} />}
      {view === 'summary' && <Summary rows={locationSummary} grand={totals.final} />}
      {view === 'guide' && <Guide />}
    </>}
  </main>;
}

function Dashboard({rows,setView,setSelectedKey,selectedKeyFor}:{rows:ManagerRow[];setView:(view:'dashboard'|'review'|'summary'|'guide')=>void;setSelectedKey:(key:string)=>void;selectedKeyFor:(row:ManagerRow)=>string}){
  return <section className={styles.panel}>
    <header className={styles.panelHead}><h2>This period, by manager</h2><span>Click a manager to open the review sheet</span></header>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Manager</th><th>Location</th><th>Role</th><th>Hours</th><th>Score</th><th>Original</th><th>Extra</th><th>Final</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(row=>{
            const rowStatus=status(row);
            return <tr key={selectedKeyFor(row)} onClick={()=>{setSelectedKey(selectedKeyFor(row));setView('review')}}>
              <td><strong>{row.employee_name}</strong></td>
              <td>{row.location}</td>
              <td>{row.role || row.department || 'Manager'}</td>
              <td className={styles.num}>{row.worked_hours.toFixed(2)}h</td>
              <td className={styles.num}>{pct(row.scorePercent)}</td>
              <td className={styles.num}>{currency.format(row.original_bonus)}</td>
              <td className={styles.num}>{currency.format(row.earnedExtraBonus)}</td>
              <td className={styles.num}><strong>{currency.format(row.finalBonus)}</strong></td>
              <td><span className={`${styles.pill} ${styles[rowStatus]}`}>{statusText(rowStatus)}</span></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}

function Review({rows,selected,selectedKeyFor,setSelectedKey,update,save,saving,datesLabel,exportUrl}:{rows:ManagerRow[];selected:ManagerRow|null;selectedKeyFor:(row:ManagerRow)=>string;setSelectedKey:(key:string)=>void;update:(key:string,field:keyof ManagerRow,value:any)=>void;save:(row:ManagerRow)=>void;saving:string;datesLabel:string;exportUrl:(extra?:string)=>string}){
  if(!selected) return null;
  const key=selectedKeyFor(selected);
  return <section className={styles.reviewGrid}>
    <aside className={styles.people}>
      {rows.map(row=>{
        const rowKey=selectedKeyFor(row);
        const rowStatus=status(row);
        return <button key={rowKey} className={rowKey===key?styles.selectedPerson:''} onClick={()=>setSelectedKey(rowKey)}>
          <span><strong>{row.employee_name}</strong><small>{row.location} · {row.role || row.department || 'Manager'}</small></span>
          <i className={styles[rowStatus]} />
        </button>;
      })}
    </aside>
    <article className={styles.sheet}>
      <header>
        <div><h2>{selected.employee_name}</h2><p>{selected.location} · {selected.role || selected.department || 'Manager'} · {datesLabel}</p></div>
        <div><span>Total bonus to pay</span><strong>{currency.format(selected.finalBonus)}</strong></div>
      </header>
      <div className={styles.sheetBody}>
        <div className={styles.fields}>
          <label>7shifts hours<input value={selected.seven_shifts_hours.toFixed(2)} disabled /></label>
          <label>Additional hours<input type="number" step="0.25" value={selected.manual_hours||0} onChange={event=>update(key,'manual_hours',Number(event.target.value))} /></label>
          <label>Original bonus<input type="number" min="0" step="0.01" value={selected.original_bonus} onChange={event=>update(key,'original_bonus',Number(event.target.value))} /></label>
          <label>Max extra bonus<input value={currency.format(selected.maxExtraBonus)} disabled /></label>
        </div>

        <div className={styles.eyebrow}>Rate each area, 0 to 5</div>
        <div className={styles.rubricList}>
          {categories.map(([label,field,help])=><div key={field} className={styles.rubricItem}>
            <div><strong>{label}</strong><p>{help}</p></div>
            <RatingRail value={selected[field]} onChange={value=>update(key,field,value)} />
          </div>)}
        </div>

        <div className={styles.tally}>
          <div><span>Points</span><strong>{selected.totalPoints}/25</strong></div>
          <div><span>Score</span><strong>{pct(selected.scorePercent)}</strong></div>
          <div><span>Extra earned</span><strong>{currency.format(selected.earnedExtraBonus)}</strong></div>
          <div><span>Final payout</span><strong>{currency.format(selected.finalBonus)}</strong></div>
        </div>

        <div className={styles.notes}>
          <label>Review notes<input value={selected.notes||''} onChange={event=>update(key,'notes',event.target.value)} placeholder="Add manager notes, follow-ups, or context" /></label>
          <label>Approval<input value={selected.approval||''} onChange={event=>update(key,'approval',event.target.value)} placeholder="Approved by" /></label>
        </div>

        <div className={styles.actions}>
          <button className={styles.primaryButton} disabled={saving===key} onClick={()=>save(selected)}>{saving===key?'Saving…':'Save review'}</button>
          <button className={styles.secondaryButton} onClick={()=>window.location.href=exportUrl(`&employee_id=${encodeURIComponent(selected.employee_id)}&location=${encodeURIComponent(selected.location)}`)}>Download this manager</button>
        </div>
      </div>
    </article>
  </section>;
}

function Summary({rows,grand}:{rows:{location:string;managers:number;hours:number;final:number;done:number}[];grand:number}){
  return <section className={styles.panel}>
    <header className={styles.panelHead}><h2>By location</h2><span>Management view of payout by store</span></header>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Location</th><th>Managers</th><th>Hours</th><th>Reviews done</th><th>Final payout</th><th>% of total payout</th></tr></thead>
        <tbody>
          {rows.map(row=><tr key={row.location}>
            <td><strong>{row.location}</strong></td>
            <td className={styles.num}>{row.managers}</td>
            <td className={styles.num}>{row.hours.toFixed(1)}h</td>
            <td className={styles.num}>{row.done}/{row.managers}</td>
            <td className={styles.num}><strong>{currency.format(row.final)}</strong></td>
            <td className={styles.num}>{grand ? `${((row.final/grand)*100).toFixed(1)}%` : '—'}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

function Guide(){
  return <section className={styles.panel}>
    <header className={styles.panelHead}><h2>Rating guide</h2><span>Same calculation, cleaner review process</span></header>
    <div className={styles.notice}><strong>Math:</strong> Score = points ÷ 25. Extra earned = original bonus × 50% × score. Final payout = original bonus + extra earned.</div>
    <div className={styles.guideGrid}>
      {[['0','No mark / does not meet standard'],['1','Very poor'],['2','Needs improvement'],['3','Meets minimum standard'],['4','Good'],['5','Top performance']].map(([rating,meaning])=><div key={rating}><strong>{rating}</strong><span>{meaning}</span></div>)}
    </div>
    <div className={styles.eyebrow}>Review areas</div>
    <div className={styles.rubricList}>
      {categories.map(([label,,help])=><div key={label} className={styles.rubricItem}><div><strong>{label}</strong><p>{help}</p></div></div>)}
    </div>
  </section>;
}
