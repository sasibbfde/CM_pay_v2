import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('sync_log')
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ logs: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ logs: [], error: e.message }, { status: 500 });
  }
}
