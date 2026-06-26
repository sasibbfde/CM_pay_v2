'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',           label: 'Dashboard',   icon: '⊞' },
  { href: '/location',   label: 'By Location', icon: '📍' },
  { href: '/labour',     label: 'Labour Cost',  icon: '📊' },
  { href: '/employees',  label: 'Logbook',     icon: '👤' },
  { href: '/wages',      label: 'Wages',       icon: '💵' },
  { href: '/synclog',    label: 'Sync Log',    icon: '🔄' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav style={{
      background:'#0d1117',
      borderBottom:'1px solid rgba(255,255,255,0.07)',
      padding:'0 20px',
      display:'flex',
      alignItems:'center',
      gap:2,
      height:48,
      position:'sticky',
      top:0,
      zIndex:100,
    }}>
      <span style={{color:'#22d3ee',fontWeight:700,fontSize:14,marginRight:16,letterSpacing:'0.05em',whiteSpace:'nowrap'}}>CM PAY</span>
      {links.map(l => {
        const active = path === l.href;
        return (
          <Link key={l.href} href={l.href} style={{
            color: active ? '#ffffff' : '#6b7280',
            background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
            borderRadius: 6,
            padding: '5px 11px',
            fontSize: 12,
            fontWeight: active ? 500 : 400,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}>
            <span style={{fontSize:13}}>{l.icon}</span>{l.label}
          </Link>
        );
      })}
    </nav>
  );
}
