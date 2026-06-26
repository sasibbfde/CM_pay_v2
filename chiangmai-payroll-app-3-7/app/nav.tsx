'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',          label: 'Dashboard'  },
  { href: '/location',  label: 'By Location'},
  { href: '/insights',  label: 'Insights'   },
  { href: '/labour',    label: 'Labour Cost'},
  { href: '/employees', label: 'Logbook'    },
  { href: '/wages',     label: 'Wages'      },
  { href: '/synclog',   label: 'Sync Log'   },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav style={{background:'#0d1117',borderBottom:'1px solid rgba(255,255,255,0.07)',padding:'0 20px',display:'flex',alignItems:'center',gap:2,height:48,position:'sticky',top:0,zIndex:100}}>
      <span style={{color:'#22d3ee',fontWeight:700,fontSize:14,marginRight:16,letterSpacing:'0.05em',whiteSpace:'nowrap',flexShrink:0}}>CM PAY</span>
      <div style={{display:'flex',gap:2,overflowX:'auto'}}>
        {links.map(l => {
          const active = path === l.href;
          return (
            <Link key={l.href} href={l.href} style={{color:active?'#ffffff':'#6b7280',background:active?'rgba(255,255,255,0.08)':'transparent',borderRadius:6,padding:'5px 12px',fontSize:12,fontWeight:active?500:400,textDecoration:'none',whiteSpace:'nowrap'}}>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
