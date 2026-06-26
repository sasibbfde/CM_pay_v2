import { NextRequest, NextResponse } from 'next/server';
import { mockEmployees } from '@/lib/mock-data';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ source: 'mock', employees: mockEmployees });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ source: 'supabase', employees: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ source: 'mock - supabase not connected', employees: mockEmployees, error: error.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('employees')
      .upsert(body, { onConflict: 'employee_id' })
      .select();
    if (error) throw error;
    return NextResponse.json({ ok: true, employees: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// PATCH /api/employees — update wage for one employee by id
export async function PATCH(req: NextRequest) {
  try {
    const { id, wage, cash_wage } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const updates: Record<string, any> = {};
    if (wage !== undefined) updates.wage = Number(wage);
    if (cash_wage !== undefined) updates.cash_wage = Number(cash_wage);
    const { error } = await supabase.from('employees').update(updates).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
