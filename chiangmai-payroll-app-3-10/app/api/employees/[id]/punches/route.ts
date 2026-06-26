import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const sp = req.nextUrl.searchParams;

    // Support both from/to date strings and year/month
    let start: string, end: string;
    if (sp.get('from') && sp.get('to')) {
      start = sp.get('from')! + 'T00:00:00';
      end   = sp.get('to')!   + 'T23:59:59';
    } else {
      const year  = Number(sp.get('year')  || new Date().getFullYear());
      const month = Number(sp.get('month') || new Date().getMonth() + 1);
      start = new Date(year, month - 1, 1).toISOString();
      end   = new Date(year, month, 0, 23, 59, 59).toISOString();
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('punches')
      .select('punch_id, clocked_in, clocked_out, hours, payroll_hours, gross_hours, break_minutes, location, department, role, wage')
      .or(`employee_id.eq.7S-${id},employee_id.eq.${id}`)
      .gte('clocked_in', start)
      .lte('clocked_in', end)
      .order('clocked_in', { ascending: false });

    if (error) throw error;

    const punches = (data || []).map(p => ({
      ...p,
      payroll_hours: Number(p.payroll_hours || p.hours || 0),
      gross_hours:   Number(p.gross_hours   || p.hours || 0),
      break_minutes: Number(p.break_minutes || 0),
      hours:         Number(p.hours         || 0),
    }));

    // Sum ONLY completed shifts (payroll_hours from 7shifts)
    const totalPayrollHours = punches
      .filter(p => p.clocked_out)
      .reduce((s, p) => s + p.payroll_hours, 0);

    return NextResponse.json({
      punches,
      summary: {
        total_payroll_hours: Math.round(totalPayrollHours * 100) / 100,
        shifts:  punches.length,
        ongoing: punches.filter(p => !p.clocked_out).length,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ punches: [], error: e.message }, { status: 500 });
  }
}
