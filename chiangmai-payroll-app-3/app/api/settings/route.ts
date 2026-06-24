import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';

const defaults = {
  company_name: 'Chiang Mai Group',
  periods: ['1-15', '16-end', 'month'],
  locations: ['Imm Thai Kitchen', 'Chiang Mai Junction', 'Chiang Mai Liberty Village', 'Chiang Mai SQ1', 'Chiang Mai York Mills', 'Chiang Mai Parklawn', 'Chiang Mai Danforth', 'Office']
};

export async function GET() {
  if (!hasSupabaseEnv()) return NextResponse.json({ source: 'mock', settings: defaults });
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    const settings = Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
    return NextResponse.json({ source: 'supabase', settings: { ...defaults, ...settings } });
  } catch (error: any) {
    return NextResponse.json({ source: 'mock - supabase not connected', settings: defaults, error: error.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = Object.entries(body).map(([key, value]) => ({ key, value }));
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' }).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, settings: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
