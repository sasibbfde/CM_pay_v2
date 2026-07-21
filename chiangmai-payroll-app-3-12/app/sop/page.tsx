import Link from 'next/link';
import type { CSSProperties } from 'react';

const card: CSSProperties = {
  background: '#131720',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14,
  padding: 18,
};
const muted: CSSProperties = { color: '#9ca3af', fontSize: 13, lineHeight: 1.65 };
const pill: CSSProperties = {
  display: 'inline-block',
  border: '1px solid rgba(34,211,238,.25)',
  background: 'rgba(34,211,238,.08)',
  color: '#22d3ee',
  borderRadius: 999,
  padding: '3px 9px',
  fontSize: 11,
  marginRight: 6,
  marginBottom: 6,
};

const sections = [
  {
    title: 'Command Center',
    href: '/command-center',
    purpose: 'Owner/manager front page for daily overview, payroll readiness, location budget pressure, and action items.',
    use: [
      'Start here each day to see today sales, today labour, pay-period cheque/cash hours, total payroll, alerts, and readiness checks.',
      'Use Today, Yesterday, Last 7 days, Payroll period, This month, or Last month to change the whole Command Center date range.',
      'Use Payroll readiness cards to jump directly to Wages, Payroll Hours, or Logbook when something needs attention.',
      'Use Location budget pressure to see actual labour versus sales, future scheduled hours, and the suggested action for each location.',
      'Click Sync 7shifts schedule in the Schedule forecast card to pull future scheduled shifts for the selected period. This is planning-only and does not change payroll punches.',
      'Review Projected over 88h and Projected near 88h before approving the next schedule.',
      'Use Owner report actions to download payroll-ready Excel, the Command Center workbook, or insights workbook for the selected filter/date range.',
    ],
  },
  {
    title: 'Dashboard',
    href: '/',
    purpose: 'Payroll overview for the selected year, month, and pay period.',
    use: [
      'Choose the period at the top: 1–15, 16–End, or full month.',
      'Use Pull from 7shifts when you want to refresh the selected payroll period.',
      'Review workers, total hours, cheque hours, cash hours, payroll total, cash total, and rule exceptions.',
    ],
  },
  {
    title: 'Budget Tool',
    href: '/budget',
    purpose: 'Weekly sales versus labour view for management planning.',
    use: [
      'Pull Snappy sales from 7shifts when sales are missing.',
      'Review daily actual sales, projected sales, actual labour, and labour percentage by location.',
      'Use this for operational decisions, not final payroll approval.',
    ],
  },
  {
    title: 'Insights',
    href: '/insights',
    purpose: 'Management analytics for sales, labour, workers, roles, and top earners.',
    use: [
      'Use Today, Yesterday, Last 7 days, 1–15, 16–End, This month, or Custom.',
      'Sales come from Snappy/7shifts or manual sales entries.',
      'Labour comes from synced payroll punches.',
    ],
  },
  {
    title: 'Labour Cost',
    href: '/labour',
    purpose: 'Management labour cost view grouped by Back of House, Front of House, and Managers.',
    use: [
      'Payable labour by department uses completed 7shifts punches.',
      'Department grouping is based on employee role/department mapping in the app.',
      'The daily matrix shows actual sales, projected sales, total labour, payable hours, and department percentage of sales.',
    ],
  },
  {
    title: 'Payroll Hours',
    href: '/payroll-hours',
    purpose: 'Main payroll export and approval page.',
    use: [
      'Select the payroll period, then click Sync selected period for that exact payroll run.',
      'Payroll uses 7shifts Hours & Wages as the authority, then applies saved employee rules.',
      'Exports include location tabs, holiday columns, cheque/cash split, and rule notes.',
    ],
  },
  {
    title: 'Manager Bonus',
    href: '/manager-bonus',
    purpose: 'Manager bonus calculation and review.',
    use: [
      'Managers are pulled from employees with manager roles/department.',
      'Use the location and period filters, add manual hours if needed, then score the 0–5 categories.',
      'Export one manager, one location, or bulk reports.',
    ],
  },
  {
    title: 'Analytics',
    href: '/analytics',
    purpose: 'Embedded accountant/payroll analytics dashboard.',
    use: [
      'Use this when managers need the separate payroll analytics dashboard inside CM Pay.',
      'This is for management visibility and accountant-reviewed payroll views.',
    ],
  },
  {
    title: 'By Location',
    href: '/location',
    purpose: 'Payroll totals split by actual worked location.',
    use: [
      'Multi-location employees are split into each location they actually worked.',
      'Each location has its own 88-hour cheque allocation unless a special rule says otherwise.',
      'Use this to verify location payroll before running each location payroll separately.',
    ],
  },
  {
    title: 'Logbook',
    href: '/employees',
    purpose: 'Employee punch history and individual audit view.',
    use: [
      'Search an employee, choose month/pay period/custom range, and view punch-by-punch detail.',
      'Shows gross hours, break minutes, payroll hours, location, role, cheque wage, cash wage, and pay estimate.',
      'Saved alerts for overnight punches and 14h+ days appear here for the selected employee.',
    ],
  },
  {
    title: 'Wages',
    href: '/wages',
    purpose: 'Employee wage, cash wage, and standing payroll rules management.',
    use: [
      'Edit cheque/cash wage and save permanently.',
      'Sync employee data to pull higher wages from 7shifts when wage sync is enabled.',
      'Add, edit, or remove rules such as cash-only, payroll cap, hold payroll, fixed salary, or pay under another location.',
      'Use Export CSV to download the current filtered wage list.',
    ],
  },
  {
    title: 'Sync Log',
    href: '/synclog',
    purpose: 'Audit trail for 7shifts sync activity.',
    use: [
      'Review who triggered sync, date range, number of users/punches synced, and notes.',
      'Use this when checking whether a period was refreshed after 7shifts changes.',
    ],
  },
];

export default function SopPage() {
  return (
    <main style={{background:'#090c10',minHeight:'100vh',color:'#e5e7eb',fontFamily:'Inter,sans-serif',padding:'28px 36px'}}>
      <section style={{maxWidth:1180,margin:'0 auto'}}>
        <div style={{marginBottom:22}}>
          <div style={{color:'#22d3ee',fontSize:12,fontWeight:800,letterSpacing:'.14em',textTransform:'uppercase'}}>CM Pay Standard Operating Procedure</div>
          <h1 style={{fontSize:34,lineHeight:1.1,margin:'8px 0 8px',color:'#f9fafb'}}>How to use the payroll app safely</h1>
          <p style={{...muted,maxWidth:860}}>
            This SOP explains where every tool is located, what each tab is for, and the safe workflow for syncing 7shifts,
            reviewing payroll, managing wages/rules, and exporting reports. Use this page as the front-door guide for managers.
          </p>
          <div style={{marginTop:12}}>
            <span style={pill}>7shifts punches</span>
            <span style={pill}>Snappy sales</span>
            <span style={pill}>Supabase saved data</span>
            <span style={pill}>Payroll exports</span>
            <span style={pill}>Saved alerts</span>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:14,marginBottom:18}}>
          <div style={card}>
            <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Correct payroll workflow</h2>
            <ol style={{...muted,margin:'0 0 0 18px',padding:0}}>
              <li>Start in <Link href="/command-center" style={{color:'#22d3ee'}}>Command Center</Link> to check readiness and alerts.</li>
              <li>Choose the correct quick filter: Today, Yesterday, Last 7 days, Payroll period, This month, or Last month.</li>
              <li>Go to <Link href="/payroll-hours" style={{color:'#22d3ee'}}>Payroll Hours</Link> for the exact payroll run.</li>
              <li>Select the exact year, month, and pay period.</li>
              <li>Click <strong>Sync selected period</strong>. Do not use top Sync Now for a past payroll period.</li>
              <li>Return to Command Center and review alerts, rule exceptions, missing wages, and location totals.</li>
              <li>Click <strong>Sync 7shifts schedule</strong> in Command Center if you want projected hours for the rest of the period.</li>
              <li>Export Excel only after totals match the 7shifts Hours & Wages report.</li>
            </ol>
          </div>
          <div style={card}>
            <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Top-right Sync Now</h2>
            <p style={muted}>The top navigation Sync Now is a quick daily sync for yesterday and today. It is useful for live management views, but it is not the button for a closed payroll run.</p>
          </div>
          <div style={card}>
            <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Forecast and management planning</h2>
            <p style={muted}>Schedule forecast uses 7shifts scheduled shifts from today through the selected period end. It helps managers see future scheduled hours, projected over-88 employees, and locations that may be over-budget before payroll is finalized. It never edits historical punches or payroll-hour totals.</p>
          </div>
          <div style={card}>
            <h2 style={{fontSize:16,margin:'0 0 8px',color:'#f9fafb'}}>Notifications</h2>
            <p style={muted}>The bell in the top-right shows saved alerts from synced punches: overnight/early-morning punch activity that touches 12:05am to 7:00am Toronto time, and any employee over 14 gross hours in one Toronto date.</p>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(330px,1fr))',gap:14}}>
          {sections.map(section=>(
            <article key={section.href} style={card}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'}}>
                <h2 style={{fontSize:18,margin:0,color:'#f9fafb'}}>{section.title}</h2>
                <Link href={section.href} style={{color:'#22d3ee',fontSize:12,textDecoration:'none'}}>Open →</Link>
              </div>
              <p style={{...muted,margin:'8px 0 10px'}}>{section.purpose}</p>
              <ul style={{...muted,margin:'0 0 0 18px',padding:0}}>
                {section.use.map(item=><li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
