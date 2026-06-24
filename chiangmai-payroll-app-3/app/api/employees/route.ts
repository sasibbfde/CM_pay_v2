import { NextRequest, NextResponse } from 'next/server';
import { mockEmployees } from '@/lib/mock-data';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';

export async function GET() {
  if (!hasSupabaseEnv()) return NextResponse.json({ source: 'mock', employees: mockEmployees });
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employees').select('*').order('full_name');
    if (error) throw error;
    return NextResponse.json({ source: 'supabase', employees: data?.length ? data : mockEmployees });
  } catch (error: any) {
    return NextResponse.json({ source: 'mock - supabase not connected', employees: mockEmployees, error: error.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employees').upsert(body, { onConflict: 'employee_id' }).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, employees: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
