import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get('from');
    const to   = sp.get('to');
    const supabase = getSupabaseAdmin();
    let q = supabase.from('daily_sales').select('*').order('sale_date', { ascending: false });
    if (from) q = q.gte('sale_date', from);
    if (to)   q = q.lte('sale_date', to);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ sales: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ sales: [], error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json();
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('daily_sales')
      .upsert(rows, { onConflict: 'sale_date,location' });
    if (error) throw error;
    return NextResponse.json({ ok: true, saved: rows.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
