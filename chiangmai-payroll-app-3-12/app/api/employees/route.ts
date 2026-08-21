import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { firstPayrollPeriodEnd, isNewEmployee } from '@/lib/employee-status';
import { applyCashWage } from '@/lib/cash-rates';
import { insertWageHistoryRows, manualWageHistoryRow } from '@/lib/wage-history';

const PAGE = 1000;

async function fetchAllEmployees(supabase: any, activeFilter: 'active' | 'inactive' | 'all') {
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from('employees')
      .select('id, employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage, wage_locked, wage_source, active, created_at')
      .range(from, from + PAGE - 1).order('full_name');
    if (activeFilter === 'active') q = q.eq('active', true);
    if (activeFilter === 'inactive') q = q.eq('active', false);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function torontoDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function isSameTorontoMonth(value?: string | null, now = new Date()) {
  const date = torontoDate(value);
  const current = torontoDate(now.toISOString());
  return Boolean(date && current && date.slice(0, 7) === current.slice(0, 7));
}

async function punchSummarySinceJan(supabase: any, employeeIds: string[]) {
  const summary = new Map<string, {
    first_payroll_date: string;
    last_payroll_date: string;
    last_punch_at: string;
    payroll_hours_since_jan: number;
    locations: Set<string>;
  }>();
  if (!employeeIds.length) return summary;
  const start = `${new Date().getFullYear()}-01-01T00:00:00.000Z`;
  for (let i = 0; i < employeeIds.length; i += 200) {
    const ids = employeeIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('punches')
      .select('employee_id, clocked_in, payroll_hours, location')
      .in('employee_id', ids)
      .gte('clocked_in', start)
      .order('clocked_in', { ascending: true });
    if (error) throw error;
    for (const punch of data || []) {
      const employeeId = punch.employee_id;
      if (!employeeId) continue;
      const day = torontoDate(punch.clocked_in);
      const row = summary.get(employeeId) || {
        first_payroll_date: day,
        last_payroll_date: day,
        last_punch_at: punch.clocked_in,
        payroll_hours_since_jan: 0,
        locations: new Set<string>(),
      };
      if (day && (!row.first_payroll_date || day < row.first_payroll_date)) row.first_payroll_date = day;
      if (day && (!row.last_payroll_date || day > row.last_payroll_date)) row.last_payroll_date = day;
      if (punch.clocked_in && (!row.last_punch_at || punch.clocked_in > row.last_punch_at)) row.last_punch_at = punch.clocked_in;
      row.payroll_hours_since_jan = Math.round((row.payroll_hours_since_jan + Number(punch.payroll_hours || 0)) * 100) / 100;
      if (punch.location) row.locations.add(String(punch.location));
      summary.set(employeeId, row);
    }
  }
  return summary;
}

export async function GET(req: NextRequest) {
  try {
    const sp         = req.nextUrl.searchParams;
    const activeParam = sp.get('active');
    const activeFilter: 'active' | 'inactive' | 'all' =
      activeParam === 'all' ? 'all' : activeParam === 'false' ? 'inactive' : 'active';
    const supabase   = getSupabaseAdmin();

    const baseEmployees = (await fetchAllEmployees(supabase, activeFilter)).map(fillMissingRosterDetails).map(applyCashWage);
    const employeeIds = baseEmployees.map(employee => employee.employee_id).filter(Boolean);
    const punchSummary = await punchSummarySinceJan(supabase, employeeIds);
    const { data: wageLogs } = employeeIds.length
      ? await supabase
        .from('audit_log')
        .select('record_id, notes, created_at')
        .in('record_id', employeeIds)
        .in('action', ['wage_upgraded_from_7shifts', 'manual_wage_changed'])
        .order('created_at', { ascending: false })
        .limit(1000)
      : { data: [] };
    const { data: detailLogs } = employeeIds.length
      ? await supabase
        .from('audit_log')
        .select('record_id, notes, created_at')
        .in('record_id', employeeIds)
        .eq('action', 'employee_details_updated_from_7shifts')
        .order('created_at', { ascending: false })
        .limit(1000)
      : { data: [] };
    const latestWageLog = new Map<string, any>();
    for (const log of wageLogs || []) {
      if (log.record_id && !latestWageLog.has(log.record_id)) latestWageLog.set(log.record_id, log);
    }
    const latestDetailLog = new Map<string, any>();
    for (const log of detailLogs || []) {
      if (log.record_id && !latestDetailLog.has(log.record_id)) latestDetailLog.set(log.record_id, log);
    }
    const employees = baseEmployees.map(employee => {
      const wageLog = latestWageLog.get(employee.employee_id);
      const detailLog = latestDetailLog.get(employee.employee_id);
      const payroll = punchSummary.get(employee.employee_id);
      const firstSeenDate = payroll?.first_payroll_date || torontoDate(employee.created_at);
      return {
      ...employee,
      status: employee.active === false ? 'Inactive' : 'Active',
      first_payroll_date: payroll?.first_payroll_date || null,
      last_payroll_date: payroll?.last_payroll_date || null,
      last_punch_at: payroll?.last_punch_at || null,
      first_seen_date: firstSeenDate || null,
      payroll_hours_since_jan: payroll?.payroll_hours_since_jan || 0,
      worked_locations_since_jan: payroll ? [...payroll.locations].sort() : [],
      wage_updated_at:wageLog?.created_at || null,
      wage_upgrade_note:wageLog?.notes || null,
      detail_updated_at:detailLog?.created_at || null,
      detail_change_note:detailLog?.notes || null,
      new_until:firstPayrollPeriodEnd(employee.created_at),
      is_new:isNewEmployee(employee.created_at),
      is_new_this_month:isSameTorontoMonth(firstSeenDate || employee.created_at),
    };
    });

    return NextResponse.json({ employees });
  } catch (e: any) {
    return NextResponse.json({ employees: [], error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const body = await req.json().catch(() => ({}));
    const id = body.id || sp.get('id');
    const hard = body.hard === true || sp.get('hard') === 'true';
    if (!id) return NextResponse.json({ ok:false, error:'Employee id is required' }, { status:400 });
    const supabase = getSupabaseAdmin();
    const { data: current, error: currentError } = await supabase
      .from('employees')
      .select('id, employee_id, full_name, active')
      .eq('id', id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok:false, error:'Employee not found' }, { status:404 });
    if (hard) {
      if (current.active !== false) {
        return NextResponse.json({ ok:false, error:'Only inactive employees can be deleted. Terminate first, then delete.' }, { status:400 });
      }
      const { error } = await supabase.from('employees').delete().eq('id', id).eq('active', false);
      if (error) throw error;
      await supabase.from('audit_log').insert({
        action: 'employee_deleted_from_management',
        table_name: 'employees',
        record_id: current.employee_id,
        old_value: current,
        new_value: null,
        notes: `Inactive employee ${current.full_name} deleted from employee management. Historical punches/payroll rows are retained.`,
        created_at: new Date().toISOString(),
      });
      return NextResponse.json({ ok:true, deleted:true });
    }
    const { error } = await supabase.from('employees').update({ active:false, updated_at:new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await supabase.from('audit_log').insert({
      action: 'employee_terminated_from_management',
      table_name: 'employees',
      record_id: current.employee_id,
      old_value: { active: current.active },
      new_value: { active: false },
      notes: `Employee ${current.full_name} marked inactive/terminated from Employee Management.`,
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok:true, terminated:true });
  } catch (e: any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, seven_shifts_user_id, wage, cash_wage } = await req.json();
    const supabase = getSupabaseAdmin();
    const { data: current } = await supabase
      .from('employees')
      .select('employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage')
      .or(id ? `id.eq.${id}` : `seven_shifts_user_id.eq.${String(seven_shifts_user_id)}`)
      .limit(1)
      .maybeSingle();
    const updates: any = {};
    const now = new Date();
    if (wage !== undefined) {
      const value = Number(wage);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: 'wage must be a non-negative number' }, { status: 400 });
      updates.wage = value;
      const oldWage = Number(current?.wage || 0);
      if (oldWage !== value) {
        updates._wage_change_note = `Manual wage changed from $${oldWage.toFixed(2)} to $${value.toFixed(2)} on ${now.toISOString().slice(0, 10)}`;
      }
    }
    if (cash_wage !== undefined) {
      const value = Number(cash_wage);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: 'cash_wage must be a non-negative number' }, { status: 400 });
      updates.cash_wage = value;
      const oldCashWage = Number(current?.cash_wage || 0);
      if (oldCashWage !== value) {
        updates._cash_wage_change_note = `Manual cash wage changed from $${oldCashWage.toFixed(2)} to $${value.toFixed(2)} on ${now.toISOString().slice(0, 10)}`;
      }
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'wage or cash_wage required' }, { status: 400 });
    updates.wage_locked = true;
    updates.wage_source = 'manual';
    updates.updated_at = new Date().toISOString();
    const wageChangeNote = updates._wage_change_note;
    const cashWageChangeNote = updates._cash_wage_change_note;
    delete updates._wage_change_note;
    delete updates._cash_wage_change_note;
    let q = supabase.from('employees').update(updates);
    if (id)                   q = q.eq('id', id);
    else if (seven_shifts_user_id) q = q.eq('seven_shifts_user_id', String(seven_shifts_user_id));
    else return NextResponse.json({ error: 'id or seven_shifts_user_id required' }, { status: 400 });
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: 'employee not found' }, { status: 404 });
    if (wage !== undefined && current && Number(current.wage || 0) !== Number(wage)) {
      const { error: historyError } = await supabase.from('audit_log').insert({
        action: 'manual_wage_changed',
        table_name: 'employees',
        record_id: current.employee_id,
        old_value: { wage: Number(current.wage || 0) },
        new_value: { wage: Number(wage), seven_shifts_user_id: current.seven_shifts_user_id, employee_name: current.full_name },
        notes: wageChangeNote,
        created_at: now.toISOString(),
      });
      if (historyError) throw historyError;
      await insertWageHistoryRows(supabase, [manualWageHistoryRow(current, Number(current.wage || 0), Number(wage), now.toISOString())]);
    }
    if (cash_wage !== undefined && current && Number(current.cash_wage || 0) !== Number(cash_wage)) {
      const { error: cashHistoryError } = await supabase.from('audit_log').insert({
        action: 'manual_wage_changed',
        table_name: 'employees',
        record_id: current.employee_id,
        old_value: { cash_wage: Number(current.cash_wage || 0) },
        new_value: { cash_wage: Number(cash_wage), seven_shifts_user_id: current.seven_shifts_user_id, employee_name: current.full_name },
        notes: cashWageChangeNote,
        created_at: now.toISOString(),
      });
      if (cashHistoryError) throw cashHistoryError;
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
