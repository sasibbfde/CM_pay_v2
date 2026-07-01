import { NextRequest, NextResponse } from 'next/server';
import { getManagerBonusRows } from '@/lib/manager-bonus-data';
import { BONUS_CATEGORIES, normalizeRating } from '@/lib/manager-bonus';
import { getSupabaseAdmin } from '@/lib/supabase';

function validDate(value: string | null) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }

export async function GET(request: NextRequest) {
  const start = request.nextUrl.searchParams.get('start');
  const end = request.nextUrl.searchParams.get('end');
  if (!validDate(start) || !validDate(end) || start! > end!) return NextResponse.json({ error:'A valid start and end date are required' }, { status:400 });
  try {
    const result = await getManagerBonusRows(start!, end!);
    return NextResponse.json({ ...result, period_start:start, period_end:end });
  } catch (error: any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.employee_id || !body.employee_name || !body.location || !validDate(body.period_start) || !validDate(body.period_end)) {
      return NextResponse.json({ error:'Manager, location, and period are required' }, { status:400 });
    }
    const originalBonus = Number(body.original_bonus || 0);
    if (!Number.isFinite(originalBonus) || originalBonus < 0) return NextResponse.json({ error:'Original bonus must be zero or greater' }, { status:400 });
    const scores = Object.fromEntries(BONUS_CATEGORIES.map(category => [category, normalizeRating(body[category]) ]));
    const payload = {
      employee_id:String(body.employee_id), employee_name:String(body.employee_name), location:String(body.location),
      period_start:body.period_start, period_end:body.period_end, original_bonus:originalBonus, ...scores,
      notes:String(body.notes || ''), approval:String(body.approval || ''), updated_at:new Date().toISOString(),
    };
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('manager_bonus_reviews').upsert(payload, { onConflict:'employee_id,location,period_start,period_end' }).select().single();
    if (!error) return NextResponse.json({ ok:true, review:data, storageMode:'manager_bonus_reviews' });
    if (error.code !== 'PGRST205' && !/manager_bonus_reviews/i.test(error.message || '')) throw error;
    const key = `manager_bonus:${payload.period_start}:${payload.period_end}:${encodeURIComponent(payload.employee_id)}:${encodeURIComponent(payload.location)}`;
    const { error:fallbackError } = await supabase.from('settings').upsert({ key, value:payload, updated_at:new Date().toISOString() });
    if (fallbackError) throw fallbackError;
    return NextResponse.json({ ok:true, review:payload, storageMode:'settings_fallback' });
  } catch (error: any) {
    return NextResponse.json({ error:error.message }, { status:500 });
  }
}
