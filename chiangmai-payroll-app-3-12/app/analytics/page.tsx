'use client';

const ANALYTICS_URL = 'https://payroll-chiang-mai.vercel.app';

export default function AnalyticsPage() {
  return (
    <main style={{background:'#090c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'22px 28px'}}>
      <section style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap',marginBottom:16}}>
        <div>
          <h1 style={{fontSize:23,margin:0,color:'#f9fafb'}}>Analytics</h1>
          <p style={{fontSize:12,color:'#6b7280',margin:'5px 0 0'}}>
            Accountant-adjusted payroll dashboard embedded from payroll-chiang-mai.
          </p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button
            onClick={() => window.location.reload()}
            style={buttonStyle('#22d3ee')}
          >
            ↻ Reload
          </button>
          <button
            onClick={() => window.open(ANALYTICS_URL, '_blank', 'noopener,noreferrer')}
            style={buttonStyle('#34d399')}
          >
            ↗ Open full screen
          </button>
        </div>
      </section>

      <section style={{background:'#131720',border:'1px solid rgba(255,255,255,.08)',borderRadius:14,overflow:'hidden',boxShadow:'0 18px 45px rgba(0,0,0,.25)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,.07)',background:'rgba(255,255,255,.02)'}}>
          <span style={{fontSize:11,color:'#9ca3af'}}>
            Source: <span style={{color:'#22d3ee'}}>{ANALYTICS_URL}</span>
          </span>
          <span style={{fontSize:10,color:'#6b7280'}}>Manual accountant payroll dashboard</span>
        </div>
        <iframe
          title="Chiang Mai payroll analytics"
          src={ANALYTICS_URL}
          style={{width:'100%',height:'calc(100vh - 150px)',minHeight:720,border:0,display:'block',background:'#ffffff'}}
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>
    </main>
  );
}

function buttonStyle(color:string): React.CSSProperties {
  return {
    background:`color-mix(in srgb, ${color} 12%, transparent)`,
    border:`1px solid color-mix(in srgb, ${color} 32%, transparent)`,
    color,
    borderRadius:8,
    padding:'8px 14px',
    fontSize:12,
    fontWeight:600,
    cursor:'pointer',
  };
}
