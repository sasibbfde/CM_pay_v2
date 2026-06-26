'use client';
import { useEffect, useState, useMemo } from 'react';

type Employee = {
  id: string;
  seven_shifts_user_id: string | null;
  full_name: string;
  location: string;
  department: string;
  role: string;
  wage: number;
  cash_wage?: number;
  active: boolean;
};

const sel: React.CSSProperties = {
  background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7,
  color: '#e5e7eb', padding: '7px 12px', fontSize: 13, outline: 'none', cursor: 'pointer',
};

export default function WagesPage() {
  const [employees, setEmployees]   = useState<Employee[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState<Set<string>>(new Set());
  const [saved, setSaved]           = useState<Set<string>>(new Set());
  const [edits, setEdits]           = useState<Record<string, { wage: string; cash_wage: string }>>({});
  const [search, setSearch]         = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/employees?active=true&with_punches=true')
      .then(r => r.json())
      .then(d => {
        const list: Employee[] = (d.employees || [])
          .filter((e: Employee) => e.active !== false)
          .sort((a: Employee, b: Employee) => (a.full_name || '').localeCompare(b.full_name || ''));
        setEmployees(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const locations = useMemo(() => ['ALL', ...new Set(employees.map(e => e.location).filter(Boolean).sort())], [employees]);

  const filtered = useMemo(() => employees.filter(e => {
    if (locationFilter !== 'ALL' && e.location !== locationFilter) return false;
    if (search && !e.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [employees, locationFilter, search]);

  const getEdit = (id: string, field: 'wage' | 'cash_wage', fallback: number) => {
    if (edits[id]?.[field] !== undefined) return edits[id][field];
    return String(fallback ?? '');
  };

  const setEdit = (id: string, field: 'wage' | 'cash_wage', val: string) => {
    setEdits(prev => {
      const existing = prev[id] || { wage: getEdit(id, 'wage', 0), cash_wage: getEdit(id, 'cash_wage', 0) };
      return { ...prev, [id]: { ...existing, [field]: val } };
    });
    setSaved(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const save = async (emp: Employee) => {
    const id = emp.id || emp.seven_shifts_user_id || emp.full_name;
    setSaving(prev => new Set(prev).add(id));
    try {
      const wage      = parseFloat(getEdit(id, 'wage', emp.wage));
      const cash_wage = parseFloat(getEdit(id, 'cash_wage', emp.cash_wage ?? 0));
      const res = await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emp.id, seven_shifts_user_id: emp.seven_shifts_user_id, wage, cash_wage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      // Update local state
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, wage, cash_wage } : e));
      setSaved(prev => new Set(prev).add(id));
      setMsg({ text: `✓ Saved ${emp.full_name}`, ok: true });
      setTimeout(() => setMsg(null), 2500);
    } catch (e: any) {
      setMsg({ text: e.message, ok: false });
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const isDirty = (emp: Employee) => {
    const id = emp.id || emp.seven_shifts_user_id || emp.full_name;
    const e = edits[id];
    if (!e) return false;
    const wChanged  = e.wage      !== undefined && parseFloat(e.wage)      !== (emp.wage || 0);
    const cwChanged = e.cash_wage !== undefined && parseFloat(e.cash_wage) !== (emp.cash_wage || 0);
    return wChanged || cwChanged;
  };

  return (
    <div style={{ background: '#0a0c10', minHeight: '100vh', color: '#e5e7eb', fontFamily: 'Inter, sans-serif', padding: '24px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Edit Wages</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            {filtered.length} employees — edit payroll wage and cash wage per person
          </p>
        </div>
        {msg && (
          <div style={{ background: msg.ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${msg.ok ? '#34d399' : '#f87171'}`, borderRadius: 8, padding: '8px 16px', color: msg.ok ? '#34d399' : '#f87171', fontSize: 13 }}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          placeholder="Search employee…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...sel, width: 220 }}
        />
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={{ ...sel, maxWidth: 240 }}>
          {locations.map(l => <option key={l}>{l}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', padding: 60, textAlign: 'center' }}>Loading employees…</div>
      ) : (
        <div style={{ background: '#131720', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                {['Employee','Location','Department / Role','Payroll Wage ($/hr)','Cash Wage ($/hr)',''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp, i) => {
                const id = emp.id || emp.seven_shifts_user_id || emp.full_name;
                const isSaving = saving.has(id);
                const isSaved  = saved.has(id);
                const dirty    = isDirty(emp);
                const isUnknown = emp.full_name?.startsWith('Unknown (ID:');
                return (
                  <tr key={id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ fontWeight: 500, color: isUnknown ? '#f87171' : '#f9fafb' }}>{emp.full_name || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{emp.location || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#9ca3af', fontSize: 12 }}>
                      {emp.department || '—'}{emp.role ? ` · ${emp.role}` : ''}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#6b7280' }}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={getEdit(id, 'wage', emp.wage)}
                          onChange={e => setEdit(id, 'wage', e.target.value)}
                          style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#f9fafb', padding: '5px 8px', width: 90, fontSize: 13, outline: 'none' }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#fbbf24' }}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={getEdit(id, 'cash_wage', emp.cash_wage ?? 0)}
                          onChange={e => setEdit(id, 'cash_wage', e.target.value)}
                          style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#fbbf24', padding: '5px 8px', width: 90, fontSize: 13, outline: 'none' }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <button
                        onClick={() => save(emp)}
                        disabled={isSaving || !dirty}
                        style={{
                          background: isSaved ? 'rgba(52,211,153,0.1)' : dirty ? '#22d3ee' : 'transparent',
                          color: isSaved ? '#34d399' : dirty ? '#0a0c10' : '#4b5563',
                          border: isSaved ? '1px solid #34d399' : dirty ? 'none' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 6, padding: '5px 16px', fontSize: 12, fontWeight: 600,
                          cursor: dirty && !isSaving ? 'pointer' : 'default',
                          transition: 'all 0.15s', whiteSpace: 'nowrap',
                        }}
                      >
                        {isSaving ? 'Saving…' : isSaved ? '✓ Saved' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>No employees found</div>
          )}
        </div>
      )}
    </div>
  );
}
