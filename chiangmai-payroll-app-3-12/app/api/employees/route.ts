import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { firstPayrollPeriodEnd, isNewEmployee } from '@/lib/employee-status';
import { applyCashWage } from '@/lib/cash-rates';

const PAGE = 1000;

async function fetchAllEmployees(supabase: any, activeOnly: boolean) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from('employees')
      .select('id, employee_id, seven_shifts_user_id, full_name, location, department, role, wage, cash_wage, wage_locked, wage_source, active, created_at')
      .range(from, from + PAGE - 1).order('full_name');
    if (activeOnly) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp         = req.nextUrl.searchParams;
    const activeOnly = sp.get('active') !== 'false';
    const supabase   = getSupabaseAdmin();

    const baseEmployees = (await fetchAllEmployees(supabase, activeOnly)).map(fillMissingRosterDetails).map(applyCashWage);
    const employeeIds = baseEmployees.map(employee => employee.employee_id).filter(Boolean);
    const { data: wageLogs } = employeeIds.length
      ? await supabase
        .from('audit_log')
        .select('record_id, notes, created_at')
        .in('record_id', employeeIds)
        .in('action', ['wage_upgraded_from_7shifts', 'manual_wage_changed'])
        .order('created_at', { ascending: false })
        .limit(1000)
      : { data: [] };
    const latestWageLog = new Map<string, any>();
    for (const log of wageLogs || []) {
      if (log.record_id && !latestWageLog.has(log.record_id)) latestWageLog.set(log.record_id, log);
    }
    const employees = baseEmployees.map(employee => {
      const wageLog = latestWageLog.get(employee.employee_id);
      return {
      ...employee,
      wage_updated_at:wageLog?.created_at || null,
      wage_upgrade_note:wageLog?.notes || null,
      new_until:firstPayrollPeriodEnd(employee.created_at),
      is_new:isNewEmployee(employee.created_at),
    };
    });

    return NextResponse.json({ employees });
  } catch (e: any) {
    return NextResponse.json({ employees: [], error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, seven_shifts_user_id, wage, cash_wage } = await req.json();
    const supabase = getSupabaseAdmin();
    const { data: current } = await supabase
      .from('employees')
      .select('employee_id, seven_shifts_user_id, full_name, wage')
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
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'wage or cash_wage required' }, { status: 400 });
    updates.wage_locked = true;
    updates.wage_source = 'manual';
    updates.updated_at = new Date().toISOString();
    const wageChangeNote = updates._wage_change_note;
    delete updates._wage_change_note;
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
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
