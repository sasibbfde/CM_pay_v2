import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPayrollDate } from '@/lib/payroll';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const sp = req.nextUrl.searchParams;

    // Support both from/to date strings and year/month
    let startDate: string, endDate: string;
    if (sp.get('from') && sp.get('to')) {
      startDate = sp.get('from')!;
      endDate   = sp.get('to')!;
    } else {
      const year  = Number(sp.get('year')  || new Date().getFullYear());
      const month = Number(sp.get('month') || new Date().getMonth() + 1);
      startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      endDate   = `${year}-${String(month).padStart(2,'0')}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`;
    }
    const queryStart = new Date(`${startDate}T00:00:00Z`);
    queryStart.setUTCDate(queryStart.getUTCDate() - 1);
    const queryEnd = new Date(`${endDate}T23:59:59Z`);
    queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);

    const supabase = getSupabaseAdmin();

    // Try multiple ID formats to ensure we find the punches
    const cleanId = id.replace('7S-', '');
    const [{ data, error }, { data: employee }] = await Promise.all([
      supabase
        .from('punches')
        .select('punch_id, employee_id, clocked_in, clocked_out, hours, payroll_hours, gross_hours, break_minutes, location, department, role, wage, cash_wage')
        .or(`employee_id.eq.7S-${cleanId},employee_id.eq.${cleanId},seven_shifts_user_id.eq.${cleanId}`)
        .gte('clocked_in', queryStart.toISOString())
        .lte('clocked_in', queryEnd.toISOString())
        .order('clocked_in', { ascending: false }),
      supabase
        .from('employees')
        .select('wage, cash_wage')
        .or(`employee_id.eq.7S-${cleanId},employee_id.eq.${cleanId},seven_shifts_user_id.eq.${cleanId}`)
        .limit(1)
        .maybeSingle(),
    ]);

    if (error) throw error;

    const punches = (data || []).filter(p => {
      const date = getPayrollDate(p.clocked_in);
      return date >= startDate && date <= endDate;
    }).map(p => {
      const storedHours = Number(p.hours || 0);
      const timestampGross = p.clocked_out
        ? Math.max(0, Math.round((new Date(p.clocked_out).getTime() - new Date(p.clocked_in).getTime()) / 36000) / 100)
        : 0;
      return {
        ...p,
        payroll_hours: p.payroll_hours == null ? storedHours : Number(p.payroll_hours),
        gross_hours:   Number(p.gross_hours) > 0 ? Number(p.gross_hours) : timestampGross,
        break_minutes: Number(p.break_minutes || 0),
        hours:         storedHours,
        // Older imported punches may not have stored wage data. Use the employee
        // wage only as a fallback; synced historical punch wages remain preferred.
        wage:          Number(p.wage) > 0 ? Number(p.wage) : Number(employee?.wage || 0),
        cash_wage:     Number(p.cash_wage) > 0 ? Number(p.cash_wage) : Number(employee?.cash_wage || 0),
      };
    });

    // Total = sum of PAYROLL hours (break-deducted, 7shifts approved) only for completed shifts
    const totalPayrollHours = punches
      .filter(p => p.clocked_out)
      .reduce((s, p) => s + p.payroll_hours, 0);
    const totalPayrollPay = punches
      .filter(p => p.clocked_out)
      .reduce((sum, punch) => sum + punch.payroll_hours * Number(punch.wage || 0), 0);

    return NextResponse.json({
      punches,
      summary: {
        total_payroll_hours: Math.round(totalPayrollHours * 100) / 100,
        total_payroll_pay: Math.round(totalPayrollPay * 100) / 100,
        shifts:  punches.length,
        ongoing: punches.filter(p => !p.clocked_out).length,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ punches: [], error: e.message }, { status: 500 });
  }
}
