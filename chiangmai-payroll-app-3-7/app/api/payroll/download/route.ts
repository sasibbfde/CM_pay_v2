import { NextRequest, NextResponse } from 'next/server';
import { calculatePayroll, filterPunches, summarize } from '@/lib/payroll';
import { getSupabaseAdmin } from '@/lib/supabase';
import { EmployeeRule, Punch } from '@/lib/types';
import * as XLSX from 'xlsx';

// ─── helpers ────────────────────────────────────────────────────────────────

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapPunch(r: any): Punch {
  return {
    punch_id:      r.punch_id,
    employee_id:   r.employee_id,
    employee_name: r.employee_name,
    location:      r.location,
    department:    r.department,
    role:          r.role,
    clocked_in:    r.clocked_in,
    clocked_out:   r.clocked_out,
    hours:         toNum(r.hours),
    wage:          toNum(r.wage),
    source:        r.source || 'supabase',
  };
}

function mapRule(r: any): EmployeeRule {
  return {
    employee_name:      r.employee_name,
    rule_type:          r.rule_type,
    rule_value:         r.rule_value,
    combined_locations: r.combined_locations,
    payroll_location:   r.payroll_location,
    notes:              r.notes,
    active:             r.active !== false,
    effective_from:     r.effective_from,
    effective_to:       r.effective_to,
  };
}

function money(n: number) {
  return `$${(n || 0).toFixed(2)}`;
}

function periodLabel(year: number, month: number, period: string) {
  const mName = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long' });
  if (period === '1-15')   return `${mName} 1–15, ${year}`;
  if (period === '16-end') return `${mName} 16–End, ${year}`;
  return `${mName} Full Month, ${year}`;
}

// ─── route ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const year   = Number(sp.get('year')   || new Date().getFullYear());
  const month  = Number(sp.get('month')  || new Date().getMonth() + 1);
  const period = sp.get('period') || '1-15';

  try {
    const supabase = getSupabaseAdmin();

    const [{ data: punchData, error: punchErr }, { data: ruleData, error: ruleErr }] =
      await Promise.all([
        supabase.from('punches').select('*'),
        supabase.from('employee_rules').select('*').eq('active', true),
      ]);

    if (punchErr) throw punchErr;
    if (ruleErr)  throw ruleErr;

    const punches = (punchData || []).map(mapPunch);
    const rules   = (ruleData  || []).map(mapRule);

    const filtered = filterPunches(punches, year, month, period);
    const rows     = calculatePayroll(filtered, rules);
    const summary  = summarize(rows);

    const label = periodLabel(year, month, period);

    // ── Sheet 1: Payroll Detail ────────────────────────────────────
    const detailHeaders = [
      'Employee', 'Location', 'Department', 'Role',
      'Actual Hrs', 'Payroll Hrs', 'Cash Hrs',
      'Wage', 'Payroll Amount', 'Cash Amount',
      'Rule Applied', 'Notes',
    ];

    const detailData = rows.map((r) => [
      r.employee_name,
      r.location,
      r.department || '',
      r.role        || '',
      r.actual_hours,
      r.payroll_hours,
      r.cash_hours,
      r.wage,
      r.payroll_amount,
      r.cash_amount,
      r.rule_applied,
      r.notes || '',
    ]);

    const detailSheet = XLSX.utils.aoa_to_sheet([
      [`Chiang Mai Group — Payroll: ${label}`],
      [],
      detailHeaders,
      ...detailData,
      [],
      [
        'TOTALS', '', '', '',
        summary.totalHours, summary.payrollHours, summary.cashHours,
        '', summary.payrollAmount, summary.cashAmount, '', '',
      ],
    ]);

    // Column widths
    detailSheet['!cols'] = [
      { wch: 24 }, { wch: 26 }, { wch: 18 }, { wch: 16 },
      { wch: 11 }, { wch: 12 }, { wch: 10 },
      { wch: 8  }, { wch: 16  }, { wch: 14 },
      { wch: 22 }, { wch: 40 },
    ];

    // ── Sheet 2: Summary by Location ──────────────────────────────
    const byLocation = new Map<string, { payroll: number; cash: number; employees: Set<string> }>();
    for (const r of rows) {
      const entry = byLocation.get(r.location) || { payroll: 0, cash: 0, employees: new Set() };
      entry.payroll += r.payroll_amount;
      entry.cash    += r.cash_amount;
      entry.employees.add(r.employee_name);
      byLocation.set(r.location, entry);
    }

    const summaryHeaders = ['Location', 'Employees', 'Payroll Amount', 'Cash Amount', 'Total'];
    const summaryData    = [...byLocation.entries()].map(([loc, d]) => [
      loc,
      d.employees.size,
      d.payroll,
      d.cash,
      d.payroll + d.cash,
    ]);

    const summarySheet = XLSX.utils.aoa_to_sheet([
      [`Summary by Location — ${label}`],
      [],
      summaryHeaders,
      ...summaryData,
      [],
      [
        'GRAND TOTAL',
        summary.employees,
        summary.payrollAmount,
        summary.cashAmount,
        summary.payrollAmount + summary.cashAmount,
      ],
    ]);

    summarySheet['!cols'] = [
      { wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
    ];

    // ── Sheet 3: Rule Exceptions ───────────────────────────────────
    const exceptions     = rows.filter((r) => r.rule_applied !== 'STANDARD');
    const exceptionSheet = XLSX.utils.aoa_to_sheet([
      [`Rule Exceptions — ${label}`],
      [],
      ['Employee', 'Location', 'Rule Applied', 'Payroll Hrs', 'Cash Hrs', 'Payroll Amount', 'Cash Amount', 'Notes'],
      ...exceptions.map((r) => [
        r.employee_name, r.location, r.rule_applied,
        r.payroll_hours, r.cash_hours,
        r.payroll_amount, r.cash_amount,
        r.notes || '',
      ]),
    ]);

    exceptionSheet['!cols'] = [
      { wch: 24 }, { wch: 26 }, { wch: 24 },
      { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 40 },
    ];

    // ── Assemble workbook ──────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, detailSheet,    'Payroll Detail');
    XLSX.utils.book_append_sheet(wb, summarySheet,   'Summary by Location');
    XLSX.utils.book_append_sheet(wb, exceptionSheet, 'Rule Exceptions');

    const buffer   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `CM_Payroll_${year}_${String(month).padStart(2,'0')}_${period.replace(/[^a-z0-9]/gi,'-')}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
