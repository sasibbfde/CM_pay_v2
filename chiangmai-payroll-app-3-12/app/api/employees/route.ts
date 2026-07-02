import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { firstPayrollPeriodEnd, isNewEmployee } from '@/lib/employee-status';

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

    const employees = (await fetchAllEmployees(supabase, activeOnly)).map(fillMissingRosterDetails).map(employee => ({
      ...employee,
      new_until:firstPayrollPeriodEnd(employee.created_at),
      is_new:isNewEmployee(employee.created_at),
    }));

    return NextResponse.json({ employees });
  } catch (e: any) {
    return NextResponse.json({ employees: [], error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, seven_shifts_user_id, wage, cash_wage } = await req.json();
    const supabase = getSupabaseAdmin();
    const updates: any = {};
    if (wage !== undefined) {
      const value = Number(wage);
      if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: 'wage must be a non-negative number' }, { status: 400 });
      updates.wage = value;
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
    let q = supabase.from('employees').update(updates);
    if (id)                   q = q.eq('id', id);
    else if (seven_shifts_user_id) q = q.eq('seven_shifts_user_id', String(seven_shifts_user_id));
    else return NextResponse.json({ error: 'id or seven_shifts_user_id required' }, { status: 400 });
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: 'employee not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
