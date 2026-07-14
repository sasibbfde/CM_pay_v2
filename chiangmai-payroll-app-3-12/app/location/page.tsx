'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { cachedJson, peekJson } from '@/lib/client-cache';
import { payrollLocationView, type PayrollReportRow } from '@/lib/payroll-report';

type PayrollRow = {
  employee_name: string;
  location: string;
  department?: string;
  role?: string;
  gross_hours: number;
  break_hours: number;
  payable_hours: number;
  rounded_hours: number;
  cheque_hours: number;
  cash_hours: number;
  wage: number;
  payroll_amount: number;
  cash_amount: number;
  rule_applied: string;
  notes?: string;
};

const RULE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  STANDARD:                 { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Standard' },
  CASH_ONLY:                { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24', label: 'Cash Only' },
  PAYROLL_HOURS_CAP:        { bg: 'rgba(34,211,238,0.12)',  color: '#22d3ee', label: 'Hours Cap' },
  COMBINED_LOCATION_CAP:    { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa', label: 'Combined Cap' },
  SALARY_FIXED:             { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa', label: 'Fixed Salary' },
  HOLD_PAYROLL:             { bg: 'rgba(248,113,113,0.15)', color: '#f87171', label: 'On Hold' },
  PAY_UNDER_OTHER_LOCATION: { bg: 'rgba(52,211,153,0.12)',  color: '#34d399', label: 'Rerouted' },
  NOTE_ONLY:                { bg: 'rgba(107,114,128,0.12)', color: '#9ca3af', label: 'Note' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const cad = (n: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n || 0);
const cadFull = (n: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
const hrs = (n: number) => `${(n || 0).toFixed(2)}h`;
function periodRange(year:number,month:number,period:string){const prefix=`${year}-${String(month).padStart(2,'0')}`;const last=String(new Date(year,month,0).getDate()).padStart(2,'0');return{start:`${prefix}-${period==='16-end'?'16':'01'}`,end:`${prefix}-${period==='1-15'?'15':last}`};}
function locationRows(reportRows:PayrollReportRow[]):PayrollRow[]{return reportRows.flatMap(row=>row.locations.map(location=>{const local=payrollLocationView(row,location);return{employee_name:row.employee_name,location,department:row.roles[0]||'',role:row.roles.join(', '),gross_hours:local.gross_hours,break_hours:local.break_hours,payable_hours:local.payable_hours,rounded_hours:local.rounded_hours,cheque_hours:local.cheque_hours,cash_hours:local.cash_hours,wage:local.wage,payroll_amount:local.cheque_pay,cash_amount:local.cash_pay,rule_applied:local.rule_type,notes:local.notes};}));}

export default function LocationPage() {
  const now = new Date();
  const initialRange=periodRange(now.getFullYear(),now.getMonth()+1,'month');
  const initialUrl = `/api/payroll-report?start=${initialRange.start}&end=${initialRange.end}`;
  const initial = peekJson<{rows:PayrollReportRow[]}>(initialUrl);
  const [rows, setRows]         = useState<PayrollRow[]>(() => locationRows(initial?.rows || []));
  const [loading, setLoading]   = useState(() => !initial);
  const [year, setYear]         = useState(new Date().getFullYear());
  const [month, setMonth]       = useState(new Date().getMonth() + 1);
  const [period, setPeriod]     = useState<string>('month');
  const [selectedLoc, setSelectedLoc] = useState<string>('ALL');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch]     = useState('');
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    const range=periodRange(year,month,period);const url = `/api/payroll-report?start=${range.start}&end=${range.end}`;
    const cached = peekJson<{rows:PayrollReportRow[]}>(url);
    if (cached) setRows(locationRows(cached.rows || []));
    setLoading(!cached);
    cachedJson<{rows:PayrollReportRow[]}>(url)
      .then(d => { if (seq === loadSeq.current) { setRows(locationRows(d.rows || [])); setLoading(false); } })
      .catch(() => { if (seq === loadSeq.current) setLoading(false); });
  }, [year, month, period]);

  // All unique locations from data
  const locations = useMemo(() => {
    const locs = [...new Set(rows.map(r => r.location).filter(Boolean))].sort();
    return ['ALL', ...locs];
  }, [rows]);

  // Group by location
  const grouped = useMemo(() => {
    const filtered = rows.filter(r => {
      if (selectedLoc !== 'ALL' && r.location !== selectedLoc) return false;
      if (search && !r.employee_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const map = new Map<string, PayrollRow[]>();
    for (const row of filtered) {
      const loc = row.location || 'Unknown';
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(row);
    }
    return map;
  }, [rows, selectedLoc, search]);

  const locTotals = (locRows: PayrollRow[]) => ({
    employees: locRows.length,
    grossHours: locRows.reduce((s, r) => s + r.gross_hours, 0),
    breakHours: locRows.reduce((s, r) => s + r.break_hours, 0),
    payableHours: locRows.reduce((s, r) => s + r.payable_hours, 0),
    roundedHours: locRows.reduce((s, r) => s + r.rounded_hours, 0),
    chequeHours: locRows.reduce((s, r) => s + r.cheque_hours, 0),
    cashHours: locRows.reduce((s, r) => s + r.cash_hours, 0),
    payrollAmount: locRows.reduce((s, r) => s + r.payroll_amount, 0),
    cashAmount: locRows.reduce((s, r) => s + r.cash_amount, 0),
  });

  const grandTotal = useMemo(() => {
    const all = [...grouped.values()].flat();
    return locTotals(all);
  }, [grouped]);

  const toggleExpand = (loc: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(grouped.keys()));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div style={{ background: '#0a0c10', minHeight: '100vh', color: '#e5e7eb', fontFamily: 'Inter, sans-serif', padding: '24px 32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Payroll by Location</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            {[...grouped.values()].flat().length} employees across {grouped.size} locations
          </p>
        </div>

        {/* Period controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={year} onChange={e => setYear(+e.target.value)} style={sel}>
            {[2024,2025,2026].map(y => <option key={y}>{y}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(+e.target.value)} style={sel}>
            {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <select value={period} onChange={e => setPeriod(e.target.value)} style={sel}>
            <option value="1-15">1 – 15</option>
            <option value="16-end">16 – End</option>
            <option value="month">Full Month</option>
          </select>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search employee…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...sel, width: 200 }}
        />
        <select value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)} style={{ ...sel, maxWidth: 220 }}>
          {locations.map(l => <option key={l}>{l}</option>)}
        </select>
        <button onClick={expandAll} style={btnGhost}>Expand all</button>
        <button onClick={collapseAll} style={btnGhost}>Collapse all</button>
      </div>

      {/* Grand total banner */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Employees', val: grandTotal.employees },
          { label: 'Gross hrs', val: hrs(grandTotal.grossHours) },
          { label: 'Break hrs', val: hrs(grandTotal.breakHours) },
          { label: 'Payable hrs', val: hrs(grandTotal.payableHours) },
          { label: 'Cheque hrs', val: hrs(grandTotal.chequeHours) },
          { label: 'Cash hrs', val: hrs(grandTotal.cashHours) },
          { label: 'Payroll $', val: cad(grandTotal.payrollAmount) },
          { label: 'Cash $', val: cad(grandTotal.cashAmount) },
        ].map(k => (
          <div key={k.label} style={{ background: '#131720', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 18px', minWidth: 120 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f9fafb', marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([loc, locRows]) => {
            const t = locTotals(locRows);
            const isOpen = expanded.has(loc);
            return (
              <div key={loc} style={{ background: '#131720', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>

                {/* Location header — clickable to expand */}
                <div
                  onClick={() => toggleExpand(loc)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', gap: 16, flexWrap: 'wrap' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 18, color: isOpen ? '#22d3ee' : '#9ca3af', transition: 'transform 0.2s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: '#f9fafb' }}>{loc}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{t.employees} employees</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <Stat label="Gross hrs" val={hrs(t.grossHours)} />
                    <Stat label="Break hrs" val={hrs(t.breakHours)} />
                    <Stat label="Payable hrs" val={hrs(t.payableHours)} color="#22d3ee" />
                    <Stat label="Cheque hrs" val={hrs(t.chequeHours)} />
                    <Stat label="Cash hrs" val={hrs(t.cashHours)} color="#fbbf24" />
                    <Stat label="Payroll $" val={cadFull(t.payrollAmount)} color="#34d399" />
                    <Stat label="Cash $" val={cadFull(t.cashAmount)} color="#fbbf24" />
                  </div>
                </div>

                {/* Employee table */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                          {['Employee','Department','Role','Gross hrs','Break hrs','Payable hrs','Rounded','Cheque hrs','Cash hrs','Wage','Payroll $','Cash $','Rule'].map(h => (
                            <th key={h} style={{ padding: '9px 14px', textAlign: 'left', color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {locRows.sort((a,b) => a.employee_name.localeCompare(b.employee_name)).map((row, i) => {
                          const rs = RULE_STYLE[row.rule_applied] || RULE_STYLE.STANDARD;
                          const isUnknown = row.employee_name.startsWith('Unknown (ID:');
                          return (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                              <td style={{ padding: '8px 14px', color: isUnknown ? '#f87171' : '#e5e7eb', fontWeight: isUnknown ? 600 : 400 }}>{row.employee_name}</td>
                              <td style={{ padding: '8px 14px', color: '#9ca3af' }}>{row.department || '–'}</td>
                              <td style={{ padding: '8px 14px', color: '#9ca3af' }}>{row.role || '–'}</td>
                              <td style={{ padding: '8px 14px', color: '#e5e7eb', textAlign: 'right' }}>{hrs(row.gross_hours)}</td>
                              <td style={{ padding: '8px 14px', color: '#9ca3af', textAlign: 'right' }}>{hrs(row.break_hours)}</td>
                              <td style={{ padding: '8px 14px', color: '#22d3ee', textAlign: 'right', fontWeight: 600 }}>{hrs(row.payable_hours)}</td>
                              <td style={{ padding: '8px 14px', color: '#d1d5db', textAlign: 'right' }}>{hrs(row.rounded_hours)}</td>
                              <td style={{ padding: '8px 14px', color: '#e5e7eb', textAlign: 'right' }}>{hrs(row.cheque_hours)}</td>
                              <td style={{ padding: '8px 14px', color: row.cash_hours > 0 ? '#fbbf24' : '#6b7280', textAlign: 'right' }}>{hrs(row.cash_hours)}</td>
                              <td style={{ padding: '8px 14px', color: '#9ca3af', textAlign: 'right' }}>${(row.wage||0).toFixed(2)}</td>
                              <td style={{ padding: '8px 14px', color: '#34d399', textAlign: 'right', fontWeight: 500 }}>{cadFull(row.payroll_amount)}</td>
                              <td style={{ padding: '8px 14px', color: row.cash_amount > 0 ? '#fbbf24' : '#6b7280', textAlign: 'right' }}>{cadFull(row.cash_amount)}</td>
                              <td style={{ padding: '8px 14px' }}>
                                <span style={{ background: rs.bg, color: rs.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>{rs.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Location totals row */}
                        <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', background: 'rgba(34,211,238,0.04)' }}>
                          <td style={{ padding: '9px 14px', fontWeight: 600, color: '#22d3ee' }} colSpan={3}>Total</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#e5e7eb' }}>{hrs(t.grossHours)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#9ca3af' }}>{hrs(t.breakHours)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: '#22d3ee' }}>{hrs(t.payableHours)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#e5e7eb' }}>{hrs(t.roundedHours)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#e5e7eb' }}>{hrs(t.chequeHours)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: '#fbbf24' }}>{hrs(t.cashHours)}</td>
                          <td style={{ padding: '9px 14px' }}></td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: '#34d399' }}>{cadFull(t.payrollAmount)}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 700, color: '#fbbf24' }}>{cadFull(t.cashAmount)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, val, color }: { label: string; val: string | number; color?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color || '#e5e7eb' }}>{val}</div>
    </div>
  );
}

const sel: React.CSSProperties = {
  background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
  color: '#e5e7eb', padding: '7px 12px', fontSize: 13, outline: 'none', cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
  color: '#9ca3af', padding: '7px 14px', fontSize: 12, cursor: 'pointer',
};
