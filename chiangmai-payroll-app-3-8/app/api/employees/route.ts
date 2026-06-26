import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const PAGE = 1000;

async function fetchAllEmployees(supabase: any, activeOnly: boolean) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from('employees').select('*').range(from, from + PAGE - 1).order('full_name');
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
    const withPunches = sp.get('with_punches') === 'true';
    const supabase   = getSupabaseAdmin();

    let employees = await fetchAllEmployees(supabase, activeOnly);

    if (withPunches) {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      let from = 0;
      const activeIds = new Set<string>();
      while (true) {
        const { data } = await supabase
          .from('punches')
          .select('employee_id')
          .gte('clocked_in', since.toISOString())
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        data.forEach((p: any) => activeIds.add(p.employee_id));
        if (data.length < PAGE) break;
        from += PAGE;
      }
      employees = employees.filter((e: any) => activeIds.has(e.employee_id));
    }

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
    if (wage      !== undefined) updates.wage      = Number(wage);
    if (cash_wage !== undefined) updates.cash_wage = Number(cash_wage);
    let q = supabase.from('employees').update(updates);
    if (id)                   q = q.eq('id', id);
    else if (seven_shifts_user_id) q = q.eq('seven_shifts_user_id', String(seven_shifts_user_id));
    else return NextResponse.json({ error: 'id or seven_shifts_user_id required' }, { status: 400 });
    const { error } = await q;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
