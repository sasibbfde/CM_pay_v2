import { NextRequest, NextResponse } from 'next/server';
import { mockRules } from '@/lib/mock-data';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';

export async function GET() {
  if (!hasSupabaseEnv()) return NextResponse.json({ source: 'mock', rules: mockRules });
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employee_rules').select('*').eq('active', true).order('employee_name');
    if (error) throw error;
    return NextResponse.json({ source: 'supabase', rules: data?.length ? data : mockRules });
  } catch (error: any) {
    return NextResponse.json({ source: 'mock - supabase not connected', rules: mockRules, error: error.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employee_rules').upsert(body).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, rules: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
