import { NextRequest, NextResponse } from 'next/server';
import { calculatePayroll, filterPunches, summarize } from '@/lib/payroll';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';
import { EmployeeRule, Punch } from '@/lib/types';

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapPunch(r: any): Punch {
  return {
    punch_id: r.punch_id,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    location: r.location,
    department: r.department,
    role: r.role,
    clocked_in: r.clocked_in,
    clocked_out: r.clocked_out,
    hours: toNum(r.hours),
    wage: toNum(r.wage),
    source: r.source || 'supabase'
  };
}

function mapRule(r: any): EmployeeRule {
  return {
    employee_name: r.employee_name,
    rule_type: r.rule_type,
    rule_value: r.rule_value,
    combined_locations: r.combined_locations,
    payroll_location: r.payroll_location,
    notes: r.notes,
    active: r.active !== false,
    effective_from: r.effective_from,
    effective_to: r.effective_to
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get('year') || new Date().getFullYear());
  const month = Number(sp.get('month') || new Date().getMonth() + 1);
  const period = sp.get('period') || 'month';

  if (!hasSupabaseEnv()) {
    return NextResponse.json({
      source: 'supabase not configured',
      summary: {
        totalHours: 0,
        payrollHours: 0,
        cashHours: 0,
        payrollAmount: 0,
        cashAmount: 0,
        exceptions: 0
      },
      rows: [],
      monthly: [],
      yearly: []
    });
  }

  try {
    const supabase = getSupabaseAdmin();

    const [
      { data: punchData, error: punchError },
      { data: ruleData, error: ruleError }
    ] = await Promise.all([
      supabase.from('punches').select('*'),
      supabase.from('employee_rules').select('*').eq('active', true)
    ]);

    if (punchError) throw punchError;
    if (ruleError) throw ruleError;

    const punches: Punch[] = (punchData || []).map(mapPunch);
    const rules: EmployeeRule[] = (ruleData || []).map(mapRule);

    const periodPunches = filterPunches(punches, year, month, period);
    const rows = calculatePayroll(periodPunches, rules);
    const summary = summarize(rows);

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const p = filterPunches(punches, year, i + 1, 'month');
      const r = calculatePayroll(p, rules);
      const s = summarize(r);

      return {
        month: new Date(year, i, 1).toLocaleString('en', { month: 'short' }),
        payrollAmount: s.payrollAmount,
        totalHours: s.totalHours
      };
    });

    const yearly = [
      {
        year,
        payrollAmount: monthly.reduce((s, m) => s + m.payrollAmount, 0),
        totalHours: monthly.reduce((s, m) => s + m.totalHours, 0)
      }
    ];

    return NextResponse.json({
      source: 'supabase',
      summary,
      rows,
      monthly,
      yearly,
      counts: {
        punches: punches.length,
        rules: rules.length
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        source: 'supabase error',
        error: error.message,
        summary: {
          totalHours: 0,
          payrollHours: 0,
          cashHours: 0,
          payrollAmount: 0,
          cashAmount: 0,
          exceptions: 0
        },
        rows: [],
        monthly: [],
        yearly: []
      },
      { status: 200 }
    );
  }
}
