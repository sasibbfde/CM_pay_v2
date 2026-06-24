'use client';
import {useEffect,useMemo,useState} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,CartesianGrid} from 'recharts';
import {CalendarDays,Users,Wallet,Clock,AlertTriangle,RefreshCw} from 'lucide-react';

type ApiData={summary:any;rows:any[];monthly:any[];yearly:any[];source:string};
const money=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n||0);
export default function Home(){
 const now=new Date(); const [year,setYear]=useState(now.getFullYear()); const [month,setMonth]=useState(now.getMonth()+1); const [period,setPeriod]=useState('1-15'); const [data,setData]=useState<ApiData|null>(null); const [loading,setLoading]=useState(false);
 async function load(){setLoading(true); const res=await fetch(`/api/payroll?year=${year}&month=${month}&period=${period}`); setData(await res.json()); setLoading(false)}
 useEffect(()=>{load()},[year,month,period]);
 const byLocation=useMemo(()=>{const m=new Map<string,number>(); (data?.rows||[]).forEach(r=>m.set(r.location,(m.get(r.location)||0)+r.payroll_amount)); return [...m].map(([location,total])=>({location,total:Math.round(total*100)/100}))},[data]);
 return <main className="min-h-screen p-6 lg:p-10">
  <div className="mx-auto max-w-7xl space-y-6">
   <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div><p className="font-bold text-slate-500">Chiang Mai Group</p><h1 className="text-3xl lg:text-5xl font-black tracking-tight">Payroll Dashboard</h1><p className="text-slate-600 mt-2">Period, monthly, and yearly payroll management connected to Supabase and 7shifts.</p></div>
    <div className="card p-3 flex flex-wrap gap-2 items-center">
     <select className="input" value={year} onChange={e=>setYear(+e.target.value)}>{[2025,2026,2027].map(y=><option key={y}>{y}</option>)}</select>
     <select className="input" value={month} onChange={e=>setMonth(+e.target.value)}>{Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{new Date(2026,m-1,1).toLocaleString('en',{month:'long'})}</option>)}</select>
     <select className="input" value={period} onChange={e=>setPeriod(e.target.value)}><option value="1-15">1–15</option><option value="16-end">16–End</option><option value="month">Full Month</option></select>
     <button onClick={load} className="btn btn-primary flex gap-2"><RefreshCw size={18}/>{loading?'Loading':'Refresh'}</button>
    </div>
   </header>
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
    <Kpi icon={<Users/>} label="Employees" value={data?.summary?.employees}/><Kpi icon={<Clock/>} label="Total Hours" value={data?.summary?.totalHours}/><Kpi icon={<CalendarDays/>} label="Payroll Hours" value={data?.summary?.payrollHours}/><Kpi icon={<Wallet/>} label="Payroll Amount" value={money(data?.summary?.payrollAmount)}/><Kpi icon={<AlertTriangle/>} label="Exceptions" value={data?.summary?.exceptions}/>
   </div>
   <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <section className="card p-5"><h2 className="text-xl font-black mb-4">Location Payroll</h2><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={byLocation}><XAxis dataKey="location" tick={{fontSize:11}}/><YAxis/><Tooltip formatter={(v:any)=>money(v)}/><Bar dataKey="total" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div></section>
    <section className="card p-5"><h2 className="text-xl font-black mb-4">Monthly Trend</h2><div className="h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={data?.monthly||[]}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis/><Tooltip formatter={(v:any)=>money(v)}/><Line type="monotone" dataKey="payrollAmount" strokeWidth={3}/></LineChart></ResponsiveContainer></div></section>
   </div>
   <section className="card overflow-hidden"><div className="p-5 flex justify-between"><div><h2 className="text-xl font-black">Payroll Audit</h2><p className="text-slate-600 text-sm">Actual hours, rule applied, cheque/payroll hours, cash hours, final amount.</p></div><span className="text-xs bg-slate-100 px-3 py-1 rounded-full h-fit">Source: {data?.source}</span></div><div className="overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-100"><tr>{['Employee','Location','Actual Hrs','Rule','Payroll Hrs','Cash Hrs','Wage','Payroll','Cash','Notes'].map(h=><th className="text-left p-3 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead><tbody>{(data?.rows||[]).map((r,i)=><tr key={i} className="border-t"><td className="p-3 font-bold whitespace-nowrap">{r.employee_name}</td><td className="p-3 whitespace-nowrap">{r.location}</td><td className="p-3">{r.actual_hours}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{r.rule_applied}</span></td><td className="p-3">{r.payroll_hours}</td><td className="p-3">{r.cash_hours}</td><td className="p-3">{money(r.wage)}</td><td className="p-3 font-bold">{money(r.payroll_amount)}</td><td className="p-3">{money(r.cash_amount)}</td><td className="p-3 min-w-56 text-slate-600">{r.notes}</td></tr>)}</tbody></table></div></section>
  </div>
 </main>
}
function Kpi({icon,label,value}:{icon:any;label:string;value:any}){return <div className="card p-5"><div className="text-slate-500 mb-3">{icon}</div><p className="text-sm font-bold text-slate-500">{label}</p><p className="text-2xl font-black mt-1">{value??'—'}</p></div>}
