'use client';

import { useEffect, useMemo, useState } from 'react';
import { cachedJson, invalidateClientCache, peekJson } from '@/lib/client-cache';
import type { EmployeeRule } from '@/lib/types';

type Employee = {
  id: string;
  employee_id?: string;
  seven_shifts_user_id?: string;
  full_name: string;
  location?: string | null;
  department?: string | null;
  role?: string | null;
  wage?: number | null;
  cash_wage?: number | null;
  wage_source?: string | null;
  wage_updated_at?: string | null;
  wage_upgrade_note?: string | null;
  detail_updated_at?: string | null;
  detail_change_note?: string | null;
  active?: boolean;
  status?: string;
  created_at?: string | null;
  first_seen_date?: string | null;
  first_payroll_date?: string | null;
  last_payroll_date?: string | null;
  last_punch_at?: string | null;
  payroll_hours_since_jan?: number | null;
  worked_locations_since_jan?: string[] | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(value?: number | null) {
  const n = Number(value || 0);
  return n > 0 ? `$${n.toFixed(2)}` : '—';
}

function hours(value?: number | null) {
  const n = Number(value || 0);
  return `${n.toFixed(2)}h`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '—';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function employeeStartDate(employee: Pick<Employee, 'first_seen_date' | 'first_payroll_date' | 'created_at'>) {
  return employee.first_seen_date || employee.first_payroll_date || employee.created_at || null;
}

function newHireMonthLabel(employee: Pick<Employee, 'first_seen_date' | 'first_payroll_date' | 'created_at'>) {
  const value = employeeStartDate(employee);
  if (!value) return '';
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return '';
  if (date < new Date('2026-07-01T00:00:00')) return '';
  return `NEW ${MONTHS[date.getMonth()].toUpperCase()}`;
}

function normName(value?: string | null) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function missingDetails(employee: Employee) {
  return !employee.location || !employee.role || Number(employee.wage || 0) <= 0;
}

function ruleName(rule: EmployeeRule) {
  return String(rule.rule_type || 'RULE').replace(/_/g, ' ');
}

function ruleSummary(rule: EmployeeRule) {
  const parts = [ruleName(rule)];
  if (rule.rule_value !== undefined && rule.rule_value !== null && rule.rule_value !== '') parts.push(String(rule.rule_value));
  if (rule.payroll_location) parts.push(`pay at ${rule.payroll_location}`);
  if (rule.combined_locations) parts.push(`combined: ${rule.combined_locations}`);
  return parts.join(' · ');
}

function htmlCell(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function EmployeeManagementPage() {
  const employeeUrl = '/api/employees?active=all';
  const initialEmployees = peekJson<{ employees: Employee[] }>(employeeUrl);
  const initialRules = peekJson<{ rules: EmployeeRule[] }>('/api/rules');

  const [employees, setEmployees] = useState<Employee[]>(() => initialEmployees?.employees || []);
  const [rules, setRules] = useState<EmployeeRule[]>(() => initialRules?.rules || []);
  const [loading, setLoading] = useState(() => !initialEmployees);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    cachedJson<{ employees: Employee[] }>(employeeUrl, 120_000)
      .then((data) => setEmployees((data.employees || []).sort((a, b) => a.full_name.localeCompare(b.full_name))))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    cachedJson<{ rules: EmployeeRule[] }>('/api/rules', 120_000)
      .then((data) => setRules(data.rules || []))
      .catch(() => setRules([]));
  }, []);

  const activeRulesByEmployee = useMemo(() => {
    const map = new Map<string, EmployeeRule[]>();
    for (const rule of rules) {
      if (rule.active === false) continue;
      const keys = [rule.employee_id || '', normName(rule.employee_name)].filter(Boolean);
      for (const key of keys) map.set(key, [...(map.get(key) || []), rule]);
    }
    return map;
  }, [rules]);

  const ruleListFor = (employee: Employee) => {
    const byId = employee.employee_id ? activeRulesByEmployee.get(employee.employee_id) || [] : [];
    const byName = activeRulesByEmployee.get(normName(employee.full_name)) || [];
    const seen = new Set<string>();
    return [...byId, ...byName].filter((rule) => {
      const key = rule.id || `${rule.employee_name}:${rule.rule_type}:${rule.rule_value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const locations = useMemo(
    () => ['ALL', ...Array.from(new Set(employees.map((employee) => employee.location).filter(Boolean) as string[])).sort()],
    [employees],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (locationFilter !== 'ALL' && employee.location !== locationFilter) return false;
      if (statusFilter === 'ACTIVE' && employee.active === false) return false;
      if (statusFilter === 'INACTIVE' && employee.active !== false) return false;
      if (statusFilter === 'NEW' && !newHireMonthLabel(employee)) return false;
      if (statusFilter === 'MISSING' && !missingDetails(employee)) return false;
      if (statusFilter === 'WAGE_CHANGES' && !employee.wage_upgrade_note) return false;
      if (statusFilter === 'ROLE_CHANGES' && !employee.detail_change_note) return false;
      if (q) {
        const haystack = [
          employee.full_name,
          employee.location,
          employee.department,
          employee.role,
          employee.seven_shifts_user_id,
          employee.employee_id,
          employee.worked_locations_since_jan?.join(' '),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [employees, locationFilter, search, statusFilter]);

  const summary = useMemo(() => {
    const active = employees.filter((employee) => employee.active !== false);
    return {
      total: employees.length,
      active: active.length,
      inactive: employees.length - active.length,
      newEmployees: employees.filter((employee) => newHireMonthLabel(employee)).length,
      missing: employees.filter(missingDetails).length,
      wageChanges: employees.filter((employee) => employee.wage_upgrade_note).length,
    };
  }, [employees]);

  async function refreshEmployees() {
    setMessage('');
    setLoading(true);
    invalidateClientCache([employeeUrl]);
    try {
      const data = await cachedJson<{ employees: Employee[] }>(employeeUrl, 0);
      setEmployees((data.employees || []).sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setMessage('Employee Management refreshed.');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to refresh employees.');
    } finally {
      setLoading(false);
    }
  }

  async function terminateEmployee(employee: Employee) {
    const ok = window.confirm(`Mark ${employee.full_name} as inactive/terminated? Payroll history will stay saved.`);
    if (!ok) return;
    setBusyId(employee.id);
    setMessage('');
    try {
      const response = await fetch('/api/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: employee.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to terminate employee.');
      setEmployees((current) => current.map((row) => (row.id === employee.id ? { ...row, active: false, status: 'Inactive' } : row)));
      invalidateClientCache([employeeUrl]);
      setMessage(`${employee.full_name} marked inactive.`);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to terminate employee.');
    } finally {
      setBusyId('');
    }
  }

  async function deleteEmployee(employee: Employee) {
    const ok = window.confirm(`Permanently remove inactive employee ${employee.full_name} from Employee Management? Historical payroll rows stay retained.`);
    if (!ok) return;
    setBusyId(employee.id);
    setMessage('');
    try {
      const response = await fetch('/api/employees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: employee.id, hard: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to delete employee.');
      setEmployees((current) => current.filter((row) => row.id !== employee.id));
      invalidateClientCache([employeeUrl]);
      setMessage(`${employee.full_name} deleted from Employee Management.`);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to delete employee.');
    } finally {
      setBusyId('');
    }
  }

  function exportExcel() {
    const rows = [
      [
        'Employee',
        'Status',
        'New label',
        'Location',
        'Department',
        'Role',
        'Cheque wage',
        'Cash wage',
        'Wage source',
        'Rules',
        'First payroll / start',
        'Last payroll date',
        'Payroll hours since Jan',
        'Worked locations since Jan',
        'Wage change note',
        'Role/location change note',
        '7shifts ID',
      ],
      ...filtered.map((employee) => [
        employee.full_name,
        employee.active === false ? 'Inactive' : 'Active',
        newHireMonthLabel(employee),
        employee.location || '',
        employee.department || '',
        employee.role || '',
        Number(employee.wage || 0) || '',
        Number(employee.cash_wage || 0) || '',
        employee.wage_source || '',
        ruleListFor(employee).map(ruleSummary).join(' | '),
        shortDate(employeeStartDate(employee)),
        shortDate(employee.last_payroll_date),
        Number(employee.payroll_hours_since_jan || 0).toFixed(2),
        (employee.worked_locations_since_jan || []).join(' | '),
        employee.wage_upgrade_note || '',
        employee.detail_change_note || '',
        employee.seven_shifts_user_id || employee.employee_id || '',
      ]),
    ];
    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table border="1">${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${htmlCell(cell)}</td>`).join('')}</tr>`)
      .join('')}</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `employee_management_${stamp}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="employee-management">
      <section className="hero">
        <div>
          <p className="eyebrow">Employee Management</p>
          <h1>All employees in one view</h1>
          <p className="subcopy">
            Read-only wage and rule overview for active, inactive, new, and missing-detail employees. Edit wages/rules in the Wages tab.
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost" onClick={refreshEmployees} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button className="primary" onClick={exportExcel} disabled={filtered.length === 0}>
            ↓ Export Excel
          </button>
        </div>
      </section>

      <section className="cards">
        <button className={`card ${statusFilter === 'ALL' ? 'activeCard' : ''}`} onClick={() => setStatusFilter('ALL')}>
          <span>All employees</span>
          <strong>{summary.total}</strong>
        </button>
        <button className={`card ${statusFilter === 'ACTIVE' ? 'activeCard' : ''}`} onClick={() => setStatusFilter('ACTIVE')}>
          <span>Active</span>
          <strong>{summary.active}</strong>
        </button>
        <button className={`card ${statusFilter === 'INACTIVE' ? 'activeCard' : ''}`} onClick={() => setStatusFilter('INACTIVE')}>
          <span>Inactive</span>
          <strong>{summary.inactive}</strong>
        </button>
        <button className={`card ${statusFilter === 'NEW' ? 'activeCard' : ''}`} onClick={() => setStatusFilter('NEW')}>
          <span>New labels</span>
          <strong>{summary.newEmployees}</strong>
        </button>
        <button className={`card ${statusFilter === 'MISSING' ? 'activeCard danger' : ''}`} onClick={() => setStatusFilter('MISSING')}>
          <span>Missing details/wage</span>
          <strong>{summary.missing}</strong>
        </button>
        <button className={`card ${statusFilter === 'WAGE_CHANGES' ? 'activeCard' : ''}`} onClick={() => setStatusFilter('WAGE_CHANGES')}>
          <span>Wage changes</span>
          <strong>{summary.wageChanges}</strong>
        </button>
      </section>

      <section className="toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, role, location, 7shifts ID…" />
        <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
          {locations.map((location) => (
            <option key={location} value={location}>
              {location === 'ALL' ? 'All locations' : location}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">All status</option>
          <option value="ACTIVE">Active only</option>
          <option value="INACTIVE">Inactive only</option>
          <option value="NEW">New employees</option>
          <option value="MISSING">Missing details/wage</option>
          <option value="WAGE_CHANGES">Wage changes</option>
          <option value="ROLE_CHANGES">Role/location changes</option>
        </select>
        <button className="ghost" onClick={() => { setSearch(''); setLocationFilter('ALL'); setStatusFilter('ALL'); }}>
          Reset filters
        </button>
        <div className="count">{filtered.length} shown</div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Location</th>
              <th>Dept / Role</th>
              <th>Wages</th>
              <th>Rules</th>
              <th>Start / last payroll</th>
              <th>Hours since Jan</th>
              <th>Worked locations</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="empty">Loading employees…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={11} className="empty">No employees match these filters.</td></tr>
            ) : (
              filtered.map((employee) => {
                const newLabel = newHireMonthLabel(employee);
                const employeeRules = ruleListFor(employee);
                const isInactive = employee.active === false;
                const hasMissing = missingDetails(employee);
                return (
                  <tr key={employee.id} className={`${newLabel ? 'newRow' : ''} ${isInactive ? 'inactiveRow' : ''} ${hasMissing ? 'missingRow' : ''}`}>
                    <td>
                      <div className="nameCell">
                        <strong>{employee.full_name}</strong>
                        <span>{employee.seven_shifts_user_id || employee.employee_id || 'No 7shifts ID'}</span>
                        <div className="badges">
                          {newLabel ? <em className="badge cyan">{newLabel}</em> : null}
                          {employee.wage_upgrade_note ? <em className="badge purple">Wage changed</em> : null}
                          {employee.detail_change_note ? <em className="badge blue">Role/location changed</em> : null}
                          {hasMissing ? <em className="badge red">Needs details</em> : null}
                        </div>
                      </div>
                    </td>
                    <td><span className={`status ${isInactive ? 'off' : 'on'}`}>{isInactive ? 'Inactive' : 'Active'}</span></td>
                    <td>{employee.location || <span className="muted">No location</span>}</td>
                    <td>
                      <div>{employee.department || <span className="muted">No department</span>}</div>
                      <span className="muted">{employee.role || 'No role'}</span>
                    </td>
                    <td>
                      <div className="wageLine">Cheque <strong>{money(employee.wage)}</strong></div>
                      <div className="wageLine">Cash <strong className="cash">{money(employee.cash_wage)}</strong></div>
                      <span className="muted">{employee.wage_source || 'stored wage'}</span>
                    </td>
                    <td>
                      {employeeRules.length ? (
                        <div className="ruleList">
                          {employeeRules.slice(0, 3).map((rule) => <span key={rule.id || ruleSummary(rule)}>{ruleSummary(rule)}</span>)}
                          {employeeRules.length > 3 ? <span>+{employeeRules.length - 3} more</span> : null}
                        </div>
                      ) : <span className="muted">Standard</span>}
                    </td>
                    <td>
                      <div>Start: {shortDate(employeeStartDate(employee))}</div>
                      <span className="muted">Last: {shortDate(employee.last_payroll_date)}</span>
                    </td>
                    <td className="number">{hours(employee.payroll_hours_since_jan)}</td>
                    <td>
                      {(employee.worked_locations_since_jan || []).length ? (
                        <div className="locationList">{employee.worked_locations_since_jan!.map((location) => <span key={location}>{location}</span>)}</div>
                      ) : <span className="muted">No payroll punches since Jan</span>}
                    </td>
                    <td>
                      <div className="note">{employee.wage_upgrade_note || employee.detail_change_note || '—'}</div>
                    </td>
                    <td>
                      {isInactive ? (
                        <button className="dangerButton" disabled={busyId === employee.id} onClick={() => deleteEmployee(employee)}>Delete</button>
                      ) : (
                        <button className="ghost small" disabled={busyId === employee.id} onClick={() => terminateEmployee(employee)}>Terminate</button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <style jsx>{`
        .employee-management { min-height: 100vh; padding: 28px 34px 48px; background: var(--bg); color: var(--text); }
        .hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 20px; }
        .eyebrow { margin: 0 0 6px; text-transform: uppercase; letter-spacing: .18em; color: var(--accent); font-weight: 800; font-size: 12px; }
        h1 { margin: 0; font-size: 34px; line-height: 1.1; letter-spacing: -.04em; }
        .subcopy { margin: 10px 0 0; color: var(--muted); max-width: 920px; font-size: 14px; }
        .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
        button, input, select { font: inherit; }
        button { cursor: pointer; }
        .primary, .ghost, .dangerButton { border-radius: 12px; border: 1px solid var(--border2); padding: 10px 14px; color: var(--text); background: var(--surface); }
        .primary { background: rgba(34, 211, 238, .13); border-color: rgba(34, 211, 238, .35); color: var(--accent); font-weight: 800; }
        .ghost:hover, .primary:hover { border-color: var(--accent); }
        .small { padding: 7px 10px; font-size: 12px; }
        .dangerButton { padding: 7px 10px; color: var(--red); background: rgba(248, 113, 113, .12); border-color: rgba(248, 113, 113, .35); font-size: 12px; }
        button:disabled { opacity: .6; cursor: not-allowed; }
        .cards { display: grid; grid-template-columns: repeat(6, minmax(135px, 1fr)); gap: 12px; margin-bottom: 14px; }
        .card { text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; color: var(--text); }
        .card span { display: block; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; font-size: 11px; font-weight: 800; }
        .card strong { display: block; margin-top: 8px; font-size: 26px; line-height: 1; }
        .activeCard { border-color: rgba(34, 211, 238, .42); box-shadow: inset 0 0 0 1px rgba(34, 211, 238, .16); }
        .activeCard.danger { border-color: rgba(248, 113, 113, .5); }
        .toolbar { display: grid; grid-template-columns: minmax(280px, 1fr) 220px 210px auto auto; gap: 10px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; margin-bottom: 12px; }
        input, select { width: 100%; background: var(--surface2); border: 1px solid var(--border2); border-radius: 12px; padding: 10px 12px; color: var(--text); outline: none; }
        input:focus, select:focus { border-color: var(--accent); }
        .count { color: var(--muted); text-align: right; white-space: nowrap; }
        .notice { margin: 0 0 12px; border: 1px solid rgba(251, 191, 36, .35); background: rgba(251, 191, 36, .1); color: var(--amber); border-radius: 14px; padding: 12px 14px; }
        .tableWrap { border: 1px solid var(--border); border-radius: 18px; overflow: auto; background: var(--surface); box-shadow: var(--shadow-lg); }
        table { width: 100%; min-width: 1450px; border-collapse: collapse; }
        th { position: sticky; top: 0; z-index: 1; background: var(--nav-bg); color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 11px; text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--border); }
        td { padding: 13px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
        tbody tr:hover { background: rgba(34, 211, 238, .05); }
        .newRow { box-shadow: inset 4px 0 0 var(--accent); }
        .inactiveRow { opacity: .72; }
        .missingRow { box-shadow: inset 4px 0 0 var(--red); }
        .nameCell strong { display: block; font-size: 15px; }
        .nameCell > span, .muted { color: var(--muted); }
        .badges, .ruleList, .locationList { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
        .badge, .ruleList span, .locationList span, .status { border-radius: 999px; padding: 3px 8px; font-style: normal; font-size: 11px; font-weight: 800; line-height: 1.4; }
        .badge.cyan { background: rgba(34, 211, 238, .14); color: var(--accent); }
        .badge.purple { background: rgba(167, 139, 250, .14); color: var(--accent2); }
        .badge.blue { background: rgba(96, 165, 250, .14); color: var(--blue); }
        .badge.red { background: rgba(248, 113, 113, .14); color: var(--red); }
        .status.on { background: rgba(52, 211, 153, .14); color: var(--green); }
        .status.off { background: rgba(251, 191, 36, .14); color: var(--amber); }
        .ruleList span { background: rgba(167, 139, 250, .12); color: var(--accent2); }
        .locationList span { background: rgba(34, 211, 238, .1); color: var(--accent); }
        .wageLine { white-space: nowrap; }
        .wageLine strong { color: var(--green); }
        .wageLine .cash { color: var(--amber); }
        .number { color: var(--accent); font-weight: 900; white-space: nowrap; }
        .note { max-width: 260px; color: var(--muted); font-size: 12px; line-height: 1.45; }
        .empty { text-align: center; color: var(--muted); padding: 42px; }
        @media (max-width: 1100px) {
          .hero { flex-direction: column; }
          .cards { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
          .toolbar { grid-template-columns: 1fr; }
          .count { text-align: left; }
        }
      `}</style>
    </main>
  );
}
