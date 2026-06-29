'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { invalidateClientCache } from '@/lib/client-cache';

const links = [
  { href: '/',         label: 'Dashboard'   },
  { href: '/budget',   label: 'Budget Tool' },
  { href: '/insights', label: 'Insights'    },
  { href: '/labour',   label: 'Labour Cost' },
  { href: '/location', label: 'By Location' },
  { href: '/employees',label: 'Logbook'     },
  { href: '/wages',    label: 'Wages'       },
  { href: '/synclog',  label: 'Sync Log'    },
];

export default function Nav() {
  const path = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [msg,     setMsg]     = useState('');

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
          body: JSON.stringify({ start:`${fmt(yesterday)}T00:00:00.000Z`, end:`${fmt(today)}T23:59:59.999Z`, triggered_by:'manual-nav' }),
        }).then(r=>r.json()),
        fetch('/api/sales-sync', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ start_date: fmt(yesterday), end_date: fmt(today) }),
        }).then(r=>r.json()),
      ]);

      const punches = punchRes.synced?.punches ?? 0;
      const salesDays = salesRes.synced ?? 0;
      if (punchRes.ok !== false && salesRes.ok !== false) invalidateClientCache();
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

  return (
    <nav style={{background:'#0d1117',borderBottom:'1px solid rgba(255,255,255,0.07)',padding:'0 16px',display:'flex',alignItems:'center',gap:2,height:48,position:'sticky',top:0,zIndex:100}}>
      <span style={{color:'#22d3ee',fontWeight:700,fontSize:14,marginRight:12,letterSpacing:'0.05em',whiteSpace:'nowrap',flexShrink:0}}>CM PAY</span>
      <div style={{display:'flex',gap:2,overflowX:'auto',flex:1}}>
        {links.map(l=>{
          const active = path===l.href;
          return (
            <Link key={l.href} href={l.href} style={{color:active?'#ffffff':'#6b7280',background:active?'rgba(255,255,255,0.08)':'transparent',borderRadius:6,padding:'5px 11px',fontSize:12,fontWeight:active?500:400,textDecoration:'none',whiteSpace:'nowrap'}}>
              {l.label}
            </Link>
          );
        })}
      </div>
      {msg&&<span style={{fontSize:11,marginRight:8,whiteSpace:'nowrap',color:msg.startsWith('✓')?'#34d399':'#f87171',background:msg.startsWith('✓')?'rgba(52,211,153,0.1)':'rgba(248,113,113,0.1)',padding:'3px 8px',borderRadius:4,flexShrink:0}}>{msg}</span>}
      <span title="Auto-syncs daily at 3am EST" style={{fontSize:10,color:'#4b5563',marginRight:6,whiteSpace:'nowrap',cursor:'default',flexShrink:0}}>🔄 Auto 3am</span>
      <button onClick={quickSync} disabled={syncing} title="Sync punches + Snappy sales" style={{background:syncing?'rgba(34,211,238,0.05)':'rgba(34,211,238,0.12)',border:'1px solid rgba(34,211,238,0.3)',color:syncing?'#6b7280':'#22d3ee',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:500,cursor:syncing?'wait':'pointer',whiteSpace:'nowrap',flexShrink:0}}>
        {syncing?'Syncing…':'↻ Sync Now'}
      </button>
      <button onClick={signOut} title="Sign out" style={{background:'transparent',border:'1px solid rgba(255,255,255,0.1)',color:'#9ca3af',borderRadius:6,padding:'5px 10px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
        Sign out
      </button>
    </nav>
  );
}
