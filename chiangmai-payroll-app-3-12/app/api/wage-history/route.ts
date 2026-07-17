import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const PAGE = 500;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('audit_log')
      .select('id, action, record_id, old_value, new_value, notes, created_at')
      .in('action', ['wage_upgraded_from_7shifts', 'manual_wage_changed'])
      .order('created_at', { ascending: false })
      .limit(PAGE);

    const employeeId = sp.get('employee_id');
    const sevenShiftsUserId = sp.get('seven_shifts_user_id');
    if (employeeId) query = query.eq('record_id', employeeId);

    const { data, error } = await query;
    if (error) throw error;
    const history = (data || [])
      .filter((row: any) => !sevenShiftsUserId || String(row.new_value?.seven_shifts_user_id || '') === sevenShiftsUserId)
      .map((row: any) => ({
        id: row.id,
        employee_id: row.record_id,
        seven_shifts_user_id: row.new_value?.seven_shifts_user_id || null,
        employee_name: row.new_value?.employee_name || null,
        old_wage: Number(row.old_value?.wage || 0),
        new_wage: Number(row.new_value?.wage || 0),
        source: row.action === 'manual_wage_changed' ? 'manual' : '7shifts',
        reason: row.notes || '',
        changed_at: row.created_at,
      }));
    return NextResponse.json({ history });
  } catch (error: any) {
    return NextResponse.json({ history: [], error: error.message }, { status: 500 });
  }
}
