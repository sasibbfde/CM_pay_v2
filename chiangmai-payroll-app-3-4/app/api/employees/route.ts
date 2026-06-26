import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const activeOnly = sp.get('active') !== 'false'; // default true
    const withPunches = sp.get('with_punches') === 'true';
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('employees')
      .select('*')
      .order('full_name');

    if (activeOnly) {
      query = query.eq('active', true);
    }

    const { data: employees, error } = await query;
    if (error) throw error;

    let result = employees || [];

    // If requested, filter to only employees who punched in last 90 days
    if (withPunches) {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data: recentPunches } = await supabase
        .from('punches')
        .select('employee_id')
        .gte('clocked_in', since.toISOString());
      const activeIds = new Set((recentPunches || []).map((p: any) => p.employee_id));
      result = result.filter((e: any) => activeIds.has(e.employee_id));
    }

    return NextResponse.json({ employees: result });
  } catch (e: any) {
    return NextResponse.json({ employees: [], error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, seven_shifts_user_id, wage, cash_wage } = body;
    const supabase = getSupabaseAdmin();

    const updates: any = {};
    if (wage !== undefined)      updates.wage = Number(wage);
    if (cash_wage !== undefined) updates.cash_wage = Number(cash_wage);

    let query = supabase.from('employees').update(updates);
    if (id) {
      query = query.eq('id', id);
    } else if (seven_shifts_user_id) {
      query = query.eq('seven_shifts_user_id', String(seven_shifts_user_id));
    } else {
      return NextResponse.json({ error: 'id or seven_shifts_user_id required' }, { status: 400 });
    }

    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
