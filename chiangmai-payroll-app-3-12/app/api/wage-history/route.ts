import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchHoursAndWages, fetchUserWages, fetchUsers } from '@/lib/7shifts';
import { flattenHoursAndWagesReport } from '@/lib/hours-wages';
import { insertWageHistoryRows, normalizePayrollReportWageHistory, normalizeSevenShiftsWageHistory } from '@/lib/wage-history';

export const maxDuration = 300;

const PAGE = 500;
const PAYROLL_REPORT_LOCATION_IDS = [
  '450889',
  '458858',
  '461096',
  '461097',
  '464811',
  '465654',
  '500371',
];
const LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '500371': 'Chiang Mai Mississauga',
};

function fullName(u: any): string {
  return [String(u.first_name || '').trim(), String(u.last_name || '').trim()].filter(Boolean).join(' ') || `Staff ${u.id}`;
}

function nameKey(value?: string | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function monthPeriods(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const periods: Array<{ start: string; end: string }> = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor <= endDate) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const p1 = { start: `${yyyyMm}-01`, end: `${yyyyMm}-15` };
    const p2 = { start: `${yyyyMm}-16`, end: `${yyyyMm}-${String(lastDay).padStart(2, '0')}` };
    for (const period of [p1, p2]) {
      if (period.end < start || period.start > end) continue;
      periods.push({
        start: period.start < start ? start : period.start,
        end: period.end > end ? end : period.end,
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return periods;
}

async function auditLogHistory(supabase: any, employeeId?: string | null, sevenShiftsUserId?: string | null) {
  let query = supabase
    .from('audit_log')
    .select('id, action, record_id, old_value, new_value, notes, created_at')
    .in('action', ['wage_upgraded_from_7shifts', 'manual_wage_changed'])
    .order('created_at', { ascending: false })
    .limit(PAGE);
  if (employeeId) query = query.eq('record_id', employeeId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || [])
    .filter((row: any) => !sevenShiftsUserId || String(row.new_value?.seven_shifts_user_id || '') === sevenShiftsUserId)
    .map((row: any) => ({
      id: row.id,
      employee_id: row.record_id,
      seven_shifts_user_id: row.new_value?.seven_shifts_user_id || null,
      employee_name: row.new_value?.employee_name || null,
      old_wage: Number(row.old_value?.wage || 0),
      new_wage: Number(row.new_value?.wage || 0),
      effective_date: null,
      detected_at: row.created_at,
      source: row.action === 'manual_wage_changed' ? 'manual' : '7shifts audit',
      notes: row.notes || '',
      legacy: true,
    }));
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const supabase = getSupabaseAdmin();
    const employeeId = sp.get('employee_id');
    const sevenShiftsUserId = sp.get('seven_shifts_user_id');

    let query = supabase
      .from('employee_wage_history')
      .select('id,employee_id,seven_shifts_user_id,employee_name,location,department,role,old_wage,new_wage,effective_date,detected_at,source,notes')
      .order('effective_date', { ascending: false, nullsFirst: false })
      .order('detected_at', { ascending: false })
      .limit(PAGE);
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (sevenShiftsUserId) query = query.eq('seven_shifts_user_id', sevenShiftsUserId);

    const { data, error } = await query;
    if (!error) return NextResponse.json({ source: 'employee_wage_history', history: data || [] });
    const missingTable = error.code === '42P01'
      || error.code === 'PGRST205'
      || /employee_wage_history|schema cache|does not exist/i.test(error.message || '');
    if (!missingTable) throw error;
    const history = await auditLogHistory(supabase, employeeId, sevenShiftsUserId);
    return NextResponse.json({ source: 'audit_log_fallback', history, warning: 'employee_wage_history table is not migrated yet.' });
  } catch (error: any) {
    return NextResponse.json({ history: [], error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const start = String(body.start || `${new Date().getFullYear()}-01-01`).slice(0, 10);
    const end = String(body.end || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const mode = String(body.mode || body.source || 'user_wages');
    if (!cleanDate(start) || !cleanDate(end)) return NextResponse.json({ ok:false, error:'Valid start and end dates are required' }, { status:400 });
    const supabase = getSupabaseAdmin();
    const [usersRes, employeesRes] = await Promise.all([
      fetchUsers(),
      supabase
        .from('employees')
        .select('employee_id, seven_shifts_user_id, full_name, location, department, role, wage'),
    ]);
    if (employeesRes.error) throw employeesRes.error;
    const employeeBy7shifts = new Map<string, any>();
    for (const employee of employeesRes.data || []) {
      if (employee.seven_shifts_user_id) employeeBy7shifts.set(String(employee.seven_shifts_user_id), employee);
    }

    if (mode === 'payroll_reports') {
      const employeeByName = new Map<string, any>();
      for (const employee of employeesRes.data || []) employeeByName.set(nameKey(employee.full_name), employee);
      const rows: any[] = [];
      const errors: string[] = [];
      const periods = monthPeriods(start, end);
      for (const period of periods) {
        for (const locationId of PAYROLL_REPORT_LOCATION_IDS) {
          try {
            const report = await fetchHoursAndWages(period.start, period.end, locationId);
            const location = LOCATION_MAP[locationId] || '';
            const entries = flattenHoursAndWagesReport({ ...report, location_id: locationId, location_name: location });
            for (const entry of entries) {
              const wage = Number(entry.wage || 0);
              if (!wage || wage <= 0) continue;
              const employee = (entry.user_id ? employeeBy7shifts.get(String(entry.user_id)) : undefined)
                || employeeByName.get(nameKey(entry.employee_name));
              const observedDate = String(entry.date || entry.clocked_in || period.start).slice(0, 10);
              rows.push({
                employee_id: employee?.employee_id || (entry.user_id ? `7S-${entry.user_id}` : `HW-${nameKey(entry.employee_name)}`),
                seven_shifts_user_id: entry.user_id || employee?.seven_shifts_user_id || null,
                employee_name: employee?.full_name || entry.employee_name || 'Unknown',
                location: entry.location || location || employee?.location || null,
                department: employee?.department || null,
                role: entry.role || employee?.role || null,
                wage,
                observed_date: observedDate,
                period_start: period.start,
                period_end: period.end,
              });
            }
          } catch (error: any) {
            errors.push(`${LOCATION_MAP[locationId] || locationId} ${period.start} to ${period.end}: ${error.message}`);
          }
        }
      }
      const historyRows = normalizePayrollReportWageHistory(rows, new Date().toISOString());
      const result = await insertWageHistoryRows(supabase, historyRows);
      return NextResponse.json({
        ok: true,
        mode,
        start,
        end,
        periods_checked: periods.length,
        report_rows_found: rows.length,
        history_rows_found: historyRows.length,
        ...result,
        warning: result.warning || 'Payroll-report history uses first observed report date when exact 7shifts wage effective date is not available.',
        errors: errors.length ? errors : undefined,
      });
    }

    const rows: any[] = [];
    const errors: string[] = [];
    const users = (usersRes.data || []).filter((user: any) => user.active !== false);
    for (let index = 0; index < users.length; index += 10) {
      await Promise.all(users.slice(index, index + 10).map(async (user: any) => {
        try {
          const employee = employeeBy7shifts.get(String(user.id)) || {};
          const wages = await fetchUserWages(user.id);
          rows.push(...normalizeSevenShiftsWageHistory({
            employee_id: employee.employee_id || `7S-${user.id}`,
            seven_shifts_user_id: String(user.id),
            full_name: employee.full_name || fullName(user),
            location: employee.location || null,
            department: employee.department || null,
            role: employee.role || null,
            role_id: user.role_id,
            wage: employee.wage,
          }, wages.data || [], {
            detectedAt: new Date().toISOString(),
            earliestEffectiveDate: start,
          }));
        } catch (error: any) {
          errors.push(`${fullName(user)}: ${error.message}`);
        }
      }));
    }

    const result = await insertWageHistoryRows(supabase, rows);
    return NextResponse.json({
      ok: true,
      start,
      employees_checked: users.length,
      rows_found: rows.length,
      ...result,
      warning: result.warning || (rows.some(row => !row.effective_date)
        ? 'Some 7shifts wages had no effective_date; those are stored as detected-date evidence only.'
        : undefined),
      errors: errors.length ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
