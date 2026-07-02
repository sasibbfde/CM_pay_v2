import { NextRequest, NextResponse } from 'next/server';
import { applyEmployeeWages, calculatePayroll, filterPunches, filterPunchesByDateRange, summarize, summarizeDailyLabour, summarizeEmployeeLabourByLocation, summarizeLabourGroups } from '@/lib/payroll';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';
import { Employee, EmployeeRule, Punch } from '@/lib/types';

function toNum(v: any) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function mapPunch(r: any): Punch {
  return {
    punch_id: r.punch_id, employee_id: r.employee_id, employee_name: r.employee_name,
    location: r.location, department: r.department, role: r.role,
    clocked_in: r.clocked_in, clocked_out: r.clocked_out,
    hours: toNum(r.hours), payroll_hours:toNum(r.payroll_hours ?? r.hours), gross_hours:toNum(r.gross_hours), break_minutes:toNum(r.break_minutes), wage: toNum(r.wage), cash_wage: toNum(r.cash_wage), source: r.source || 'supabase'
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

async function fetchAll(supabase: any, table: string, columns: string, filterFn?: (q: any) => any) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
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
  const includeTrends = sp.get('include_trends') === 'true';
  const trendsOnly = sp.get('trends_only') === 'true';

  if (!hasSupabaseEnv()) {
    return NextResponse.json({ source:'supabase not configured', summary:{totalHours:0,payrollHours:0,cashHours:0,payrollAmount:0,cashAmount:0,exceptions:0}, rows:[], daily:[], labourGroups:[], monthly:[], yearly:[] });
  }

  try {
    const supabase = getSupabaseAdmin();
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`;
    const periodStart = period === '16-end' ? `${year}-${String(month).padStart(2,'0')}-16` : monthStart;
    const periodEnd = period === '1-15' ? `${year}-${String(month).padStart(2,'0')}-15` : monthEnd;
    const requestedStart = (includeTrends || trendsOnly)
      ? (fromDate && fromDate < yearStart ? fromDate : yearStart)
      : (fromDate || periodStart);
    const requestedEnd = (includeTrends || trendsOnly)
      ? (toDate && toDate > yearEnd ? toDate : yearEnd)
      : (toDate || periodEnd);
    const queryStart = new Date(`${requestedStart}T00:00:00Z`);
    queryStart.setUTCDate(queryStart.getUTCDate() - 1);
    const queryEnd = new Date(`${requestedEnd}T23:59:59Z`);
    queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);
    const [punchData, ruleData, employeeData] = await Promise.all([
      fetchAll(supabase, 'punches', 'punch_id, employee_id, employee_name, location, department, role, clocked_in, clocked_out, hours, payroll_hours, gross_hours, break_minutes, wage, cash_wage, source', query => query
        .gte('clocked_in', queryStart.toISOString())
        .lte('clocked_in', queryEnd.toISOString())
        .order('clocked_in')),
      fetchAll(supabase, 'employee_rules', 'id, employee_id, employee_name, rule_type, rule_value, combined_locations, payroll_location, notes, active, effective_from, effective_to', q => q.eq('active', true)),
      fetchAll(supabase, 'employees', 'employee_id, full_name, wage, cash_wage'),
    ]);

    const punches: Punch[]        = applyEmployeeWages(punchData.map(mapPunch), employeeData as Employee[]);
    const rules:   EmployeeRule[] = ruleData.map(mapRule);

    // Use custom date range if provided, otherwise use year/month/period
    const periodPunches = trendsOnly ? [] : (fromDate && toDate)
      ? filterPunchesByDateRange(punches, fromDate, toDate)
      : filterPunches(punches, year, month, period);

    const rows    = calculatePayroll(periodPunches, rules);
    const summary = summarize(rows);
    const daily   = summarizeDailyLabour(periodPunches);
    const labourGroups = summarizeLabourGroups(periodPunches);
    const locationRows = summarizeEmployeeLabourByLocation(periodPunches);

    // Monthly breakdown always uses year
    const monthly = (includeTrends || trendsOnly) ? Array.from({ length: 12 }, (_, i) => {
      const p = filterPunches(punches, year, i + 1, 'month');
      const r = calculatePayroll(p, rules);
      const s = summarize(r);
      return { month: new Date(year, i, 1).toLocaleString('en', { month: 'short' }), payrollAmount: s.payrollAmount, totalHours: s.totalHours };
    }) : [];

    const yearly = [{ year, payrollAmount: monthly.reduce((s,m)=>s+m.payrollAmount,0), totalHours: monthly.reduce((s,m)=>s+m.totalHours,0) }];

    return NextResponse.json({ source:'supabase', summary, rows, locationRows, daily, labourGroups, monthly, yearly, counts:{ punches: punches.length, rules: rules.length } });

  } catch (error: any) {
    return NextResponse.json({ source:'supabase error', error:error.message, summary:{totalHours:0,payrollHours:0,cashHours:0,payrollAmount:0,cashAmount:0,exceptions:0}, rows:[], daily:[], labourGroups:[], monthly:[], yearly:[] }, { status:500 });
  }
}
