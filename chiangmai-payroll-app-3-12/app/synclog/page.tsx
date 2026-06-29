'use client';
import { useEffect, useState } from 'react';
import { cachedJson, peekJson } from '@/lib/client-cache';

type SyncEntry = {
  id: string;
  synced_at: string;
  triggered_by: string;
  date_from: string;
  date_to: string;
  users_synced: number;
  punches_synced: number;
  unknown_names_before: number;
  unknown_names_after: number;
  errors: string | null;
  duration_ms: number;
  location_breakdown: Record<string, number> | null;
  notes: string | null;
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
};

const hrs = (n: number) => n ? `${n.toFixed(1)}h` : '—';

export default function SyncLogPage() {
  const initial = peekJson<{logs:SyncEntry[]}>('/api/synclog');
  const [logs, setLogs]       = useState<SyncEntry[]>(() => initial?.logs || []);
  const [loading, setLoading] = useState(() => !initial);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    cachedJson<{logs:SyncEntry[]}>('/api/synclog', 60_000)
      .then(d => setLogs(d.logs || []))
      .finally(() => setLoading(false));
  }, []);

  const total = {
    syncs:   logs.length,
    users:   logs.reduce((s, l) => s + (l.users_synced || 0), 0),
    punches: logs.reduce((s, l) => s + (l.punches_synced || 0), 0),
    errors:  logs.filter(l => l.errors).length,
  };

  return (
    <div style={{ background: '#0a0c10', minHeight: '100vh', color: '#e5e7eb', fontFamily: 'Inter, sans-serif', padding: '24px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 }}>7shifts Sync Log</h1>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>Every time data was pulled from 7shifts</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Syncs', val: total.syncs, color: '#22d3ee' },
          { label: 'Employees Pulled', val: total.users, color: '#a78bfa' },
          { label: 'Punches Pulled', val: total.punches, color: '#34d399' },
          { label: 'Sync Errors', val: total.errors, color: total.errors > 0 ? '#f87171' : '#6b7280' },
        ].map(k => (
          <div key={k.label} style={{ background: '#131720', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 20px', minWidth: 130 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', padding: 60, textAlign: 'center' }}>Loading sync log…</div>
      ) : logs.length === 0 ? (
        <div style={{ color: '#6b7280', padding: 60, textAlign: 'center' }}>
          No syncs recorded yet. Pull from 7shifts to start logging.
        </div>
      ) : (
        <div style={{ background: '#131720', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.25)' }}>
                {['Date & Time','Period Pulled','Employees','Punches','Unknown Names','Duration','Status',''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const hasError = !!log.errors;
                const isOpen = expanded === log.id;
                const unknownFixed = (log.unknown_names_before || 0) - (log.unknown_names_after || 0);
                return (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.05)',
                        background: hasError ? 'rgba(248,113,113,0.04)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 16px', color: '#f9fafb', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {fmt(log.synced_at)}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                        {log.date_from} → {log.date_to}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#a78bfa', fontWeight: 600 }}>
                        {log.users_synced ?? '—'}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#34d399', fontWeight: 600 }}>
                        {log.punches_synced ?? '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {unknownFixed > 0 ? (
                          <span style={{ color: '#34d399', fontSize: 12 }}>✓ Fixed {unknownFixed}</span>
                        ) : log.unknown_names_after > 0 ? (
                          <span style={{ color: '#fbbf24', fontSize: 12 }}>{log.unknown_names_after} remaining</span>
                        ) : (
                          <span style={{ color: '#6b7280', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {hasError ? (
                          <span style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>ERROR</span>
                        ) : (
                          <span style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>OK</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#6b7280', fontSize: 16 }}>
                        {isOpen ? '▲' : '▼'}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr key={log.id + '-detail'} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(34,211,238,0.03)' }}>
                        <td colSpan={8} style={{ padding: '16px 20px' }}>
                          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Details</div>
                              <div style={{ fontSize: 13, color: '#e5e7eb', lineHeight: 1.8 }}>
                                <div>Triggered by: <span style={{ color: '#22d3ee' }}>{log.triggered_by || 'manual'}</span></div>
                                <div>Unknown names before: <span style={{ color: '#fbbf24' }}>{log.unknown_names_before ?? '—'}</span></div>
                                <div>Unknown names after: <span style={{ color: log.unknown_names_after > 0 ? '#fbbf24' : '#34d399' }}>{log.unknown_names_after ?? '—'}</span></div>
                                {log.notes && <div>Notes: <span style={{ color: '#9ca3af' }}>{log.notes}</span></div>}
                                {log.errors && (
                                  <div style={{ marginTop: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, padding: '8px 12px', color: '#f87171', maxWidth: 500 }}>
                                    Error: {log.errors}
                                  </div>
                                )}
                              </div>
                            </div>

                            {log.location_breakdown && Object.keys(log.location_breakdown).length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Hours by Location</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {Object.entries(log.location_breakdown)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([loc, h]) => (
                                      <div key={loc} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                        <span style={{ color: '#9ca3af', fontSize: 12, minWidth: 200 }}>{loc}</span>
                                        <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>{hrs(h)}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
