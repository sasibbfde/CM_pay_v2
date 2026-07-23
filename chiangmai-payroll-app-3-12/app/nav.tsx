'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { invalidateClientCache } from '@/lib/client-cache';

const links = [
  { href: '/sop',       label: 'SOP'         },
  { href: '/command-center', label: 'Command Center' },
  { href: '/',         label: 'Dashboard'   },
  { href: '/budget',   label: 'Budget Tool' },
  { href: '/insights', label: 'Insights'    },
  { href: '/labour',   label: 'Labour Cost' },
  { href: '/payroll-hours', label: 'Payroll Hours' },
  { href: '/manager-bonus', label: 'Manager Bonus' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/location', label: 'By Location' },
  { href: '/employees',label: 'Logbook'     },
  { href: '/wages',    label: 'Wages'       },
  { href: '/synclog',  label: 'Sync Log'    },
];

type PayrollAlert = {
  id: string;
  type: string;
  employee_name: string;
  location: string;
  alert_date: string;
  severity: 'warning' | 'critical';
  message: string;
};

function alertRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { from: fmt(start), to: fmt(today) };
}

export default function Nav() {
  const path = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [alerts, setAlerts]   = useState<PayrollAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark'|'light'>('dark');

  const loadAlerts = useCallback(async () => {
    try {
      const { from, to } = alertRange();
      const res = await fetch(`/api/alerts?from=${from}&to=${to}`);
      const data = await res.json();
      if (res.ok) setAlerts(data.alerts || []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    if (path === '/login' || path === '/signup' || path.startsWith('/auth/')) return;
    loadAlerts();
    const timer = setInterval(loadAlerts, 60_000);
    return () => clearInterval(timer);
  }, [path, loadAlerts]);

  useEffect(() => {
    const saved = window.localStorage.getItem('cm-pay-theme') === 'light' ? 'light' : 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  if (path === '/login' || path === '/signup' || path.startsWith('/auth/')) return null;

  async function quickSync() {
    setSyncing(true); setMsg('');
    try {
      const today     = new Date();
      const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
      const fmt = (d: Date) => d.toISOString().split('T')[0];

      // Sync punches + sales in parallel
      const [punchRes, salesRes] = await Promise.all([
        fetch('/api/7shifts/sync', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ start:`${fmt(yesterday)}T00:00:00.000Z`, end:`${fmt(today)}T23:59:59.999Z`, triggered_by:'manual-nav', sync_wages:true }),
        }).then(r=>r.json()),
        fetch('/api/sales-sync', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ start_date: fmt(yesterday), end_date: fmt(today) }),
        }).then(r=>r.json()),
      ]);

      const punches = punchRes.synced?.punches ?? 0;
      const salesDays = salesRes.synced ?? 0;
      if (punchRes.ok !== false && salesRes.ok !== false) {
        invalidateClientCache();
        await loadAlerts();
        setTimeout(() => window.location.reload(), 700);
      }
      setMsg(`✓ ${punches} punches · ${salesDays} sales days`);
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setMsg(''), 5000);
    }
  }

  async function signOut() {
    invalidateClientCache();
    await createClient().auth.signOut();
    window.location.assign('/login');
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem('cm-pay-theme', next);
  }

  return (
    <nav style={{background:'var(--nav-bg)',borderBottom:'1px solid var(--border)',padding:'0 16px',display:'flex',alignItems:'center',gap:2,height:48,position:'sticky',top:0,zIndex:100}}>
      <span style={{color:'var(--accent)',fontWeight:700,fontSize:14,marginRight:12,letterSpacing:'0.05em',whiteSpace:'nowrap',flexShrink:0}}>CM PAY</span>
      <div style={{display:'flex',gap:2,overflowX:'auto',flex:1}}>
        {links.map(l=>{
          const active = path===l.href;
          return (
            <Link key={l.href} href={l.href} style={{color:active?'var(--nav-active-text)':'var(--muted)',background:active?'var(--nav-active-bg)':'transparent',borderRadius:6,padding:'5px 11px',fontSize:12,fontWeight:active?500:400,textDecoration:'none',whiteSpace:'nowrap'}}>
              {l.label}
            </Link>
          );
        })}
      </div>
      {msg&&<span style={{fontSize:11,marginRight:8,whiteSpace:'nowrap',color:msg.startsWith('✓')?'#34d399':'#f87171',background:msg.startsWith('✓')?'rgba(52,211,153,0.1)':'rgba(248,113,113,0.1)',padding:'3px 8px',borderRadius:4,flexShrink:0}}>{msg}</span>}
      <div style={{position:'relative',flexShrink:0,marginRight:6}}>
        <button onClick={()=>setAlertsOpen(open=>!open)} title="Payroll alerts from saved punch checks" style={{background:alerts.length?'rgba(251,191,36,0.12)':'rgba(255,255,255,0.04)',border:`1px solid ${alerts.length?'rgba(251,191,36,0.35)':'rgba(255,255,255,0.1)'}`,color:alerts.length?'#fbbf24':'#6b7280',borderRadius:6,padding:'5px 9px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
          🔔 {alerts.length}
        </button>
        {alertsOpen&&(
          <div style={{position:'absolute',right:0,top:34,width:360,maxHeight:420,overflowY:'auto',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:10,boxShadow:'var(--shadow-lg)',padding:10,zIndex:200}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>Saved payroll alerts</div>
              <button onClick={loadAlerts} style={{background:'transparent',border:'1px solid rgba(255,255,255,.1)',color:'#9ca3af',borderRadius:5,padding:'3px 7px',fontSize:10,cursor:'pointer'}}>Refresh</button>
            </div>
            {alerts.length===0 ? <div style={{fontSize:11,color:'#6b7280',padding:12,textAlign:'center'}}>No overnight or 14h+ alerts in the current or previous month.</div> :
              alerts.map(alert=>(
                <Link key={alert.id} href={`/employees?alert=${encodeURIComponent(alert.employee_name)}`} onClick={()=>setAlertsOpen(false)} style={{display:'block',textDecoration:'none',borderTop:'1px solid rgba(255,255,255,.06)',padding:'8px 2px'}}>
                  <div style={{fontSize:11,fontWeight:700,color:alert.severity==='critical'?'#f87171':'#fbbf24'}}>{alert.employee_name} · {alert.alert_date}</div>
                  <div style={{fontSize:10,color:'#9ca3af',marginTop:2}}>{alert.location || 'Unknown location'} · {alert.type.replaceAll('_',' ')}</div>
                  <div style={{fontSize:10,color:'#e5e7eb',marginTop:3,lineHeight:1.35}}>{alert.message}</div>
                </Link>
              ))}
            <div style={{fontSize:10,color:'#4b5563',paddingTop:8,lineHeight:1.35}}>Showing {alerts.length} alert{alerts.length===1?'':'s'} from the current month and previous month. Alerts are saved in audit history and do not change payroll totals.</div>
          </div>
        )}
      </div>
      <span title="Auto-syncs daily at 3am EST" style={{fontSize:10,color:'#4b5563',marginRight:6,whiteSpace:'nowrap',cursor:'default',flexShrink:0}}>🔄 Auto 3am</span>
      <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} style={{background:'var(--surface2)',border:'1px solid var(--border2)',color:'var(--text)',borderRadius:6,padding:'5px 9px',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <button onClick={quickSync} disabled={syncing} title="Sync punches + Snappy sales" style={{background:syncing?'rgba(34,211,238,0.05)':'rgba(34,211,238,0.12)',border:'1px solid rgba(34,211,238,0.3)',color:syncing?'#6b7280':'#22d3ee',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:500,cursor:syncing?'wait':'pointer',whiteSpace:'nowrap',flexShrink:0}}>
        {syncing?'Syncing…':'↻ Sync Now'}
      </button>
      <button onClick={signOut} title="Sign out" style={{background:'transparent',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:6,padding:'5px 10px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
        Sign out
      </button>
    </nav>
  );
}
