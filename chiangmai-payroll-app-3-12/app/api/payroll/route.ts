import { NextRequest, NextResponse } from 'next/server';
import { applyEmployeeWages, calculatePayroll, filterPunches, filterPunchesByDateRange, summarize } from '@/lib/payroll';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';
import { Employee, EmployeeRule, Punch } from '@/lib/types';

function toNum(v: any) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function mapPunch(r: any): Punch {
  return {
    punch_id: r.punch_id, employee_id: r.employee_id, employee_name: r.employee_name,
    location: r.location, department: r.department, role: r.role,
    clocked_in: r.clocked_in, clocked_out: r.clocked_out,
    hours: toNum(r.hours), wage: toNum(r.wage), cash_wage: toNum(r.cash_wage), source: r.source || 'supabase'
  };
}

function mapRule(r: any): EmployeeRule {
  return {
    id: r.id, employee_id: r.employee_id, employee_name: r.employee_name, rule_type: r.rule_type, rule_value: r.rule_value,
    combined_locations: r.combined_locations, payroll_location: r.payroll_location,
    notes: r.notes, active: r.active !== false,
    effective_from: r.effective_from, effective_to: r.effective_to
  };
}

async function fetchAll(supabase: any, table: string, filterFn?: (q: any) => any) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    let q = supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const year   = Number(sp.get('year')   || new Date().getFullYear());
  const month  = Number(sp.get('month')  || new Date().getMonth() + 1);
  const period = sp.get('period') || 'month';
  // Custom date range (used by Insights page)
  const fromDate = sp.get('from');
  const toDate   = sp.get('to');

  if (!hasSupabaseEnv()) {
    return NextResponse.json({ source:'supabase not configured', summary:{totalHours:0,payrollHours:0,cashHours:0,payrollAmount:0,cashAmount:0,exceptions:0}, rows:[], monthly:[], yearly:[] });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [punchData, ruleData, employeeData] = await Promise.all([
      fetchAll(supabase, 'punches'),
      fetchAll(supabase, 'employee_rules', q => q.eq('active', true)),
      fetchAll(supabase, 'employees'),
    ]);

    const punches: Punch[]        = applyEmployeeWages(punchData.map(mapPunch), employeeData as Employee[]);
    const rules:   EmployeeRule[] = ruleData.map(mapRule);

    // Use custom date range if provided, otherwise use year/month/period
    const periodPunches = (fromDate && toDate)
      ? filterPunchesByDateRange(punches, fromDate, toDate)
      : filterPunches(punches, year, month, period);

    const rows    = calculatePayroll(periodPunches, rules);
    const summary = summarize(rows);

    // Monthly breakdown always uses year
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const p = filterPunches(punches, year, i + 1, 'month');
      const r = calculatePayroll(p, rules);
      const s = summarize(r);
      return { month: new Date(year, i, 1).toLocaleString('en', { month: 'short' }), payrollAmount: s.payrollAmount, totalHours: s.totalHours };
    });

    const yearly = [{ year, payrollAmount: monthly.reduce((s,m)=>s+m.payrollAmount,0), totalHours: monthly.reduce((s,m)=>s+m.totalHours,0) }];

    return NextResponse.json({ source:'supabase', summary, rows, monthly, yearly, counts:{ punches: punches.length, rules: rules.length } });

  } catch (error: any) {
    return NextResponse.json({ source:'supabase error', error:error.message, summary:{totalHours:0,payrollHours:0,cashHours:0,payrollAmount:0,cashAmount:0,exceptions:0}, rows:[], monthly:[], yearly:[] }, { status:200 });
  }
}
