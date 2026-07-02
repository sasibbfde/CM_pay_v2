'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────
type PayrollRow = {
  employee_name: string;
  location: string;
  department?: string;
  role?: string;
  actual_hours: number;
  payroll_hours: number;
  cash_hours: number;
  wage: number;
  payroll_amount: number;
  cash_amount: number;
  rule_applied: string;
  notes?: string;
};

type ApiData = {
  summary: {
    employees: number;
    totalHours: number;
    payrollHours: number;
    cashHours: number;
    payrollAmount: number;
    cashAmount: number;
    exceptions: number;
  };
  rows: PayrollRow[];
  monthly: { month: string; payrollAmount: number; totalHours: number }[];
  source: string;
};

type SyncResult = {
  ok: boolean;
  synced?: { users: number; punches: number };
  error?: string;
  punch_error?: string;
  start?: string;
  end?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const RULE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  STANDARD:                { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Standard' },
  CASH_ONLY:               { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24', label: 'Cash Only' },
  PAYROLL_HOURS_CAP:       { bg: 'rgba(34,211,238,0.12)',  color: '#22d3ee', label: 'Hours Cap' },
  COMBINED_LOCATION_CAP:   { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa', label: 'Combined Cap' },
  SALARY_FIXED:            { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa', label: 'Fixed Salary' },
  HOLD_PAYROLL:            { bg: 'rgba(248,113,113,0.15)', color: '#f87171', label: 'On Hold' },
  PAY_UNDER_OTHER_LOCATION:{ bg: 'rgba(52,211,153,0.12)',  color: '#34d399', label: 'Rerouted' },
  NOTE_ONLY:               { bg: 'rgba(107,114,128,0.12)', color: '#9ca3af', label: 'Note' },
};

const LOCATIONS = [
  'Imm Thai Kitchen', 'Chiang Mai Junction', 'Chiang Mai Liberty Village',
  'Chiang Mai Mississauga', 'Chiang Mai York Mills', 'Chiang Mai Parklawn',
  'Chiang Mai Danforth', 'Office',
];

const SHORT_LOC: Record<string, string> = {
  'Imm Thai Kitchen':            'Imm Thai',
  'Chiang Mai Junction':         'Junction',
  'Chiang Mai Liberty Village':  'Liberty',
  'Chiang Mai Mississauga':      'Mississauga',
  'Chiang Mai York Mills':       'York Mills',
  'Chiang Mai Parklawn':         'Parklawn',
  'Chiang Mai Danforth':         'Danforth',
  'Office':                      'Office',
};

const cad = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n || 0);

const cadFull = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ROW_PAGE_SIZE = 75;

// ─── Custom chart tooltip ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border2)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
          {cadFull(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  const now = new Date();
  const initialPayrollUrl = `/api/payroll?year=${now.getFullYear()}&month=${now.getMonth() + 1}&period=1-15`;
  const [year,   setYear]   = useState(now.getFullYear());
  const [month,  setMonth]  = useState(now.getMonth() + 1);
  const [period, setPeriod] = useState('1-15');
  const [data,   setData]   = useState<ApiData | null>(() => peekJson<ApiData>(initialPayrollUrl) || null);
  const [loading,    setLoading]    = useState(() => !peekJson<ApiData>(initialPayrollUrl));
  const [downloading, setDl]        = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [filterLoc,  setFilterLoc]  = useState('');
  const [rowPage, setRowPage] = useState(0);
  const [syncOpen,   setSyncOpen]   = useState(false);
  const [syncRange,  setSyncRange]  = useState<'today'|'week'|'biweek'|'month'|'custom'>('biweek');
  const [syncStart,  setSyncStart]  = useState('');
  const [syncEnd,    setSyncEnd]    = useState('');

  const load = useCallback(async (force = false) => {
    const url = `/api/payroll?year=${year}&month=${month}&period=${period}`;
    const trendsUrl = `/api/payroll?year=${year}&month=${month}&period=month&trends_only=true`;
    const cached = !force ? peekJson<ApiData>(url) : undefined;
    const cachedTrends = !force ? peekJson<ApiData>(trendsUrl) : undefined;
    if (cached) setData(cached);
    if (cachedTrends) setData(current => current ? {...current, monthly:cachedTrends.monthly || []} : current);
    setLoading(!cached);
    try {
      const periodData = await cachedJson<ApiData>(url, 600_000, force);
      setData(current => ({...periodData, monthly:current?.monthly || cachedTrends?.monthly || []}));
      cachedJson<ApiData>(trendsUrl, 600_000, force).then(trends => {
        setData(current => current ? {...current, monthly:trends.monthly || []} : current);
      }).catch(() => { /* period payroll remains usable if trends fail */ });
    } finally {
      setLoading(false);
    }
  }, [year, month, period]);

  useEffect(() => { load(); }, [load]);

  // auto-set sync range dates when range type changes
  useEffect(() => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    if (syncRange === 'today') {
      setSyncStart(fmt(today)); setSyncEnd(fmt(today));
    } else if (syncRange === 'week') {
      const s = new Date(today); s.setDate(today.getDate() - 7);
      setSyncStart(fmt(s)); setSyncEnd(fmt(today));
    } else if (syncRange === 'biweek') {
      const d = today.getDate();
      const m = today.getMonth(); const y = today.getFullYear();
      const s = d <= 15 ? new Date(y, m, 1) : new Date(y, m, 16);
      const e = d <= 15 ? new Date(y, m, 15) : new Date(y, m+1, 0);
      setSyncStart(fmt(s)); setSyncEnd(fmt(e));
    } else if (syncRange === 'month') {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      const e = new Date(today.getFullYear(), today.getMonth()+1, 0);
      setSyncStart(fmt(s)); setSyncEnd(fmt(e));
    }
  }, [syncRange]);

  async function downloadExcel() {
    setDl(true);
    try {
      const res = await fetch(`/api/payroll/download?year=${year}&month=${month}&period=${period}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CM_Payroll_${year}_${String(month).padStart(2,'0')}_${period}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDl(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const body: Record<string, string | boolean> = { sync_wages:true };
      if (syncStart) body.start = new Date(syncStart).toISOString();
      if (syncEnd)   body.end   = new Date(syncEnd + 'T23:59:59').toISOString();
      const res = await fetch('/api/7shifts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d: SyncResult = await res.json();
      setSyncResult(d);
      if (d.ok) {
        invalidateClientCache(['/api/payroll', '/api/employees', '/api/synclog']);
        load(true);
      }
    } catch (e: any) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setSyncing(false);
    }
  }

  const byLocation = useMemo(() => {
    const m = new Map<string, number>();
    (data?.rows || []).forEach(r =>
      m.set(r.location, (m.get(r.location) || 0) + r.payroll_amount)
    );
    return [...m]
      .map(([location, total]) => ({ location: SHORT_LOC[location] || location, full: location, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  const filteredRows = useMemo(() =>
    filterLoc ? (data?.rows || []).filter(r => r.location === filterLoc) : (data?.rows || []),
    [data, filterLoc]
  );
  const rowPageCount = Math.max(1, Math.ceil(filteredRows.length / ROW_PAGE_SIZE));
  const visibleRows = filteredRows.slice(rowPage * ROW_PAGE_SIZE, (rowPage + 1) * ROW_PAGE_SIZE);
  useEffect(()=>setRowPage(0),[filterLoc,year,month,period]);

  const periodLabel = () => {
    const mName = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long' });
    if (period === '1-15')   return `${mName} 1–15, ${year}`;
    if (period === '16-end') return `${mName} 16–End, ${year}`;
    return `${mName} ${year}`;
  };

  const s = data?.summary;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Top loading bar ── */}
      {loading && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }}>
          <div className="progress-bar" style={{ borderRadius: 0 }}>
            <div className="progress-fill" style={{ width: '60%', animation: 'none', background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 60px' }}>

        {/* ══════════════════════════════════════════════════════════
            HEADER
        ══════════════════════════════════════════════════════════ */}
        <header style={{ padding: '32px 0 28px', borderBottom: '1px solid var(--border)', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>

            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#000',
                }}>CM</div>
                <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Chiang Mai Group
                </span>
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
                Payroll Dashboard
              </h1>
              <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13 }}>
                {periodLabel()} · {s?.employees ?? '—'} employees
              </p>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select className="select" value={year} onChange={e => setYear(+e.target.value)}>
                {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="select" value={month} onChange={e => setMonth(+e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
              </select>
              <select className="select" value={period} onChange={e => setPeriod(e.target.value)}>
                <option value="1-15">1 – 15</option>
                <option value="16-end">16 – End</option>
                <option value="month">Full Month</option>
              </select>

              <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />

              <button className="btn btn-ghost" onClick={()=>load(true)} disabled={loading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={loading ? 'spin' : ''}>
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
                </svg>
                {loading ? 'Loading…' : 'Refresh'}
              </button>

              <button className="btn btn-ghost" onClick={downloadExcel} disabled={downloading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {downloading ? 'Exporting…' : 'Export Excel'}
              </button>

              <button
                className="btn btn-primary"
                onClick={() => setSyncOpen(o => !o)}
                style={{ gap: 8 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg>
                Pull from 7shifts
              </button>
            </div>
          </div>

          {/* ── 7shifts Sync Panel ── */}
          {syncOpen && (
            <div className="sync-panel fade-up" style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Pull data from 7shifts</p>
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 0' }}>
                    Fetches employees and time punches into Supabase, then recalculates payroll.
                  </p>
                </div>
                <button
                  onClick={() => { setSyncOpen(false); setSyncResult(null); }}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}
                >×</button>
              </div>

              {/* Date range selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {(['today','week','biweek','month','custom'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setSyncRange(r)}
                    style={{
                      padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: syncRange === r ? 'var(--accent)' : 'var(--surface2)',
                      color: syncRange === r ? '#000' : 'var(--muted)',
                      border: `1px solid ${syncRange === r ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {{ today: 'Today', week: 'Last 7 days', biweek: 'This pay period', month: 'This month', custom: 'Custom' }[r]}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>From</label>
                  <input
                    type="date"
                    value={syncStart}
                    onChange={e => { setSyncRange('custom'); setSyncStart(e.target.value); }}
                    style={{
                      background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)',
                      borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>To</label>
                  <input
                    type="date"
                    value={syncEnd}
                    onChange={e => { setSyncRange('custom'); setSyncEnd(e.target.value); }}
                    style={{
                      background: 'var(--surface2)', border: '1px solid var(--border2)', color: 'var(--text)',
                      borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit',
                    }}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={syncNow}
                  disabled={syncing || !syncStart || !syncEnd}
                  style={{ marginLeft: 4 }}
                >
                  {syncing ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="spin">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
                      </svg>
                      Syncing…
                    </>
                  ) : '↓ Pull data now'}
                </button>
              </div>

              {/* Sync result */}
              {syncResult && (
                <div className={`fade-up ${syncResult.ok ? 'toast-success' : 'toast-error'}`} style={{ marginTop: 12 }}>
                  {syncResult.ok ? (
                    <>
                      ✓ Pulled <strong>{syncResult.synced?.users ?? 0}</strong> employees
                      and <strong>{syncResult.synced?.punches ?? 0}</strong> time punches.
                      {syncResult.punch_error && (
                        <span style={{ opacity: 0.7 }}> (punch warning: {syncResult.punch_error})</span>
                      )}
                    </>
                  ) : `Error: ${syncResult.error}`}
                </div>
              )}
            </div>
          )}
        </header>

        {/* ══════════════════════════════════════════════════════════
            KPI CARDS
        ══════════════════════════════════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <KpiCard
            label="Workers this period"
            value={s?.employees ?? "—"}
            icon={<IconUsers />}
            color="var(--accent)"
          />
          <KpiCard
            label="Total Hours"
            value={s ? `${s.totalHours}h` : '—'}
            icon={<IconClock />}
            color="var(--accent2)"
          />
          <KpiCard
            label="Payroll Hours"
            value={s ? `${s.payrollHours}h` : '—'}
            icon={<IconCalendar />}
            color="var(--blue)"
          />
          <KpiCard
            label="Cash Hours"
            value={s ? `${s.cashHours}h` : '—'}
            icon={<IconClock />}
            color="var(--amber)"
          />
          <KpiCard
            label="Payroll Total"
            value={s ? cad(s.payrollAmount) : '—'}
            icon={<IconWallet />}
            color="var(--green)"
            large
          />
          <KpiCard
            label="Cash Total"
            value={s ? cad(s.cashAmount) : '—'}
            icon={<IconWallet />}
            color="var(--amber)"
            large
          />
          <KpiCard
            label="Rule Exceptions"
            value={s?.exceptions ?? '—'}
            icon={<IconAlert />}
            color={s?.exceptions ? 'var(--red)' : 'var(--muted)'}
          />
        </div>

        {/* ══════════════════════════════════════════════════════════
            CHARTS ROW
        ══════════════════════════════════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>

          {/* Location chart */}
          <div className="card" style={{ padding: 24 }}>
            <p className="section-label">Payroll by location</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byLocation} margin={{ top: 4, bottom: 4 }} barSize={22}>
                  <XAxis
                    dataKey="location"
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="total" radius={[6,6,0,0]}
                    fill="url(#barGrad)"
                  />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly trend */}
          <div className="card" style={{ padding: 24 }}>
            <p className="section-label">Monthly payroll trend — {year}</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.monthly || []} margin={{ top: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false}/>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="payrollAmount"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#areaGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#22d3ee' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            PAYROLL TABLE
        ══════════════════════════════════════════════════════════ */}
        <div className="card" style={{ overflow: 'hidden' }}>

          {/* Table header */}
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div>
              <p className="section-label" style={{ margin: 0 }}>Payroll audit — {periodLabel()}</p>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 0' }}>
                {filteredRows.length} employees · payroll rules applied · cheque / cash split
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{fontSize:11,color:'var(--muted)'}}>
                {filteredRows.length ? `${rowPage*ROW_PAGE_SIZE+1}–${Math.min((rowPage+1)*ROW_PAGE_SIZE,filteredRows.length)} of ${filteredRows.length}` : '0 employees'}
              </span>
              <button className="btn btn-ghost" disabled={rowPage===0} onClick={()=>setRowPage(p=>Math.max(0,p-1))}>Previous</button>
              <button className="btn btn-ghost" disabled={rowPage>=rowPageCount-1} onClick={()=>setRowPage(p=>Math.min(rowPageCount-1,p+1))}>Next</button>
              <select
                className="select"
                value={filterLoc}
                onChange={e => setFilterLoc(e.target.value)}
                style={{ minWidth: 160 }}
              >
                <option value="">All locations</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <div style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                background: 'var(--surface2)', color: 'var(--muted)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {data?.source === 'supabase' ? '● live' : '○ mock'}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Location</th>
                  <th>Rule</th>
                  <th style={{ textAlign: 'right' }}>Actual hrs</th>
                  <th style={{ textAlign: 'right' }}>Payroll hrs</th>
                  <th style={{ textAlign: 'right' }}>Cash hrs</th>
                  <th style={{ textAlign: 'right' }}>Wage</th>
                  <th style={{ textAlign: 'right' }}>Payroll $</th>
                  <th style={{ textAlign: 'right' }}>Cash $</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
                      {loading
                        ? 'Loading payroll data…'
                        : 'No data for this period. Pull from 7shifts to populate.'}
                    </td>
                  </tr>
                ) : visibleRows.map((r, i) => {
                  const rs = RULE_STYLE[r.rule_applied] || RULE_STYLE.STANDARD;
                  const isException = r.rule_applied !== 'STANDARD';
                  return (
                    <tr key={i}>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.employee_name}</span>
                        {r.department && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{r.department}</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {SHORT_LOC[r.location] || r.location}
                      </td>
                      <td>
                        <span className="badge" style={{ background: rs.bg, color: rs.color }}>
                          {rs.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="num">{r.actual_hours}</td>
                      <td style={{ textAlign: 'right' }} className="num">
                        <span style={{ color: isException ? 'var(--accent)' : 'var(--text)' }}>
                          {r.payroll_hours}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="num">
                        <span style={{ color: r.cash_hours > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                          {r.cash_hours || '—'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }} className="num">
                        {cadFull(r.wage)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }} className="num">
                        {cadFull(r.payroll_amount)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="num">
                        <span style={{ color: r.cash_amount > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                          {r.cash_amount > 0 ? cadFull(r.cash_amount) : '—'}
                        </span>
                      </td>
                      <td style={{ maxWidth: 240, color: 'var(--muted)', fontSize: 11, lineHeight: 1.4 }}>
                        {r.notes || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Totals row */}
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <td colSpan={3} style={{ padding: '11px 14px', fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Period total
                    </td>
                    <td style={{ textAlign: 'right', padding: '11px 14px', fontWeight: 700 }} className="num">
                      {filteredRows.reduce((a, r) => a + r.actual_hours, 0).toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '11px 14px', fontWeight: 700, color: 'var(--accent)' }} className="num">
                      {filteredRows.reduce((a, r) => a + r.payroll_hours, 0).toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '11px 14px', fontWeight: 700, color: 'var(--amber)' }} className="num">
                      {filteredRows.reduce((a, r) => a + r.cash_hours, 0).toFixed(1)}
                    </td>
                    <td />
                    <td style={{ textAlign: 'right', padding: '11px 14px', fontWeight: 800, color: 'var(--green)', fontSize: 14 }} className="num">
                      {cadFull(filteredRows.reduce((a, r) => a + r.payroll_amount, 0))}
                    </td>
                    <td style={{ textAlign: 'right', padding: '11px 14px', fontWeight: 700, color: 'var(--amber)' }} className="num">
                      {cadFull(filteredRows.reduce((a, r) => a + r.cash_amount, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>
          Chiang Mai Group · Payroll System · Powered by 7shifts + Supabase
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, large }: {
  label: string; value: any; icon: React.ReactNode; color: string; large?: boolean;
}) {
  return (
    <div className="kpi-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ color, opacity: 0.9 }}>{icon}</div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 4px' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: large ? 22 : 20, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', letterSpacing: '-0.02em' }}>
        {value ?? '—'}
      </p>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const IconUsers  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconClock  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const IconCalendar=()=> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>;
const IconAlert  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
