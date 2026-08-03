import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchUserWages, fetchUsers } from '@/lib/7shifts';
import { insertWageHistoryRows, normalizeSevenShiftsWageHistory } from '@/lib/wage-history';

const PAGE = 500;

function fullName(u: any): string {
  return [String(u.first_name || '').trim(), String(u.last_name || '').trim()].filter(Boolean).join(' ') || `Staff ${u.id}`;
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
