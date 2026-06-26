import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id }  = await context.params;
    const sp      = req.nextUrl.searchParams;
    const year    = Number(sp.get('year')  || new Date().getFullYear());
    const month   = Number(sp.get('month') || new Date().getMonth() + 1);
    const start   = new Date(year, month - 1, 1).toISOString();
    const end     = new Date(year, month, 0, 23, 59, 59).toISOString();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('punches')
      .select('*')
      .or(`employee_id.eq.7S-${id},employee_id.eq.${id}`)
      .gte('clocked_in', start)
      .lte('clocked_in', end)
      .order('clocked_in', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ punches: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ punches: [], error: e.message }, { status: 500 });
  }
}
