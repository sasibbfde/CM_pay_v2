import { PayrollRow, Punch, EmployeeRule } from './types';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getPunchHours(p: Punch) {
  const given = Number(p.hours || 0);
  if (given > 0) return given;

  const start = new Date(p.clocked_in).getTime();
  const end   = new Date(p.clocked_out).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round((end - start) / (1000 * 60 * 60));
}

export function getPeriodRange(year: number, month: number, period: string) {
  const startMonth = month - 1;
  const endDay     = new Date(year, month, 0).getDate();

  if (period === '1-15') {
    return {
      start: new Date(year, startMonth, 1),
      end:   new Date(year, startMonth, 15, 23, 59, 59),
    };
  }
  if (period === '16-end') {
    return {
      start: new Date(year, startMonth, 16),
      end:   new Date(year, startMonth, endDay, 23, 59, 59),
    };
  }
  return {
    start: new Date(year, startMonth, 1),
    end:   new Date(year, startMonth, endDay, 23, 59, 59),
  };
}

export function filterPunches(
  punches: Punch[],
  year:    number,
  month:   number,
  period:  string
) {
  const { start, end } = getPeriodRange(year, month, period);
  return punches.filter((p) => {
    const d = new Date(p.clocked_in);
    return d >= start && d <= end;
  });
}

export function calculatePayroll(
  punches: Punch[],
  rules:   EmployeeRule[]
): PayrollRow[] {
  // ── Group punches by employee (all locations together) ──────────────
  const grouped = new Map<string, Punch[]>();
  for (const p of punches) {
    const key = norm(p.employee_name || 'Unknown');
    grouped.set(key, [...(grouped.get(key) || []), p]);
  }

  const activeRules = rules.filter((r) => r.active !== false);
  const rulesByName = new Map(activeRules.map((r) => [norm(r.employee_name), r]));

  const rows: PayrollRow[] = [];

  for (const [key, items] of grouped) {
    const first = items[0];
    const wage  = Number(first.wage || 0);
    const rule  = rulesByName.get(key);

    // Total actual hours across ALL locations
    const actual = round(items.reduce((s, p) => s + getPunchHours(p), 0));

    // Default (no rule)
    let payrollHours = actual;
    let cashHours    = 0;
    let payrollAmount = round(actual * wage);
    let cashAmount   = 0;
    let ruleApplied  = 'STANDARD';
    let notes        = '';
    let payrollLocation = first.location;

    if (rule) {
      notes       = rule.notes || '';
      ruleApplied = rule.rule_type;

      // ── CASH_ONLY ─────────────────────────────────────────────────
      if (rule.rule_type === 'CASH_ONLY') {
        payrollHours  = 0;
        cashHours     = actual;
        payrollAmount = 0;
        cashAmount    = round(actual * wage);
      }

      // ── PAYROLL_HOURS_CAP ─────────────────────────────────────────
      if (rule.rule_type === 'PAYROLL_HOURS_CAP') {
        const cap     = Number(rule.rule_value || 0);
        payrollHours  = round(Math.min(actual, cap));
        cashHours     = round(Math.max(actual - cap, 0));
        payrollAmount = round(payrollHours * wage);
        cashAmount    = round(cashHours * wage);
      }

      // ── COMBINED_LOCATION_CAP ─────────────────────────────────────
      // Hours across specific locations are combined; cap applies to total
      if (rule.rule_type === 'COMBINED_LOCATION_CAP') {
        const cap = Number(rule.rule_value || 0);

        // Which locations count toward the combined cap?
        const capLocations = (rule.combined_locations || '')
          .split(',')
          .map((l) => norm(l.trim()))
          .filter(Boolean);

        // Hours inside the cap-location group vs outside
        const cappedHours = capLocations.length
          ? round(
              items
                .filter((p) => capLocations.includes(norm(p.location)))
                .reduce((s, p) => s + getPunchHours(p), 0)
            )
          : actual;

        const uncappedHours = round(actual - cappedHours);

        // Apply cap only to the capped group
        payrollHours  = round(Math.min(cappedHours, cap) + uncappedHours);
        cashHours     = round(Math.max(cappedHours - cap, 0));
        payrollAmount = round(payrollHours * wage);
        cashAmount    = round(cashHours * wage);
      }

      // ── SALARY_FIXED ──────────────────────────────────────────────
      if (rule.rule_type === 'SALARY_FIXED') {
        payrollHours  = actual;
        cashHours     = 0;
        payrollAmount = Number(rule.rule_value || 0);
        cashAmount    = 0;
      }

      // ── HOLD_PAYROLL ──────────────────────────────────────────────
      if (rule.rule_type === 'HOLD_PAYROLL') {
        payrollHours  = 0;
        cashHours     = 0;
        payrollAmount = 0;
        cashAmount    = 0;
      }

      // ── PAY_UNDER_OTHER_LOCATION ──────────────────────────────────
      // Employee's hours are reported under a different location for payroll.
      // All actual hours go to payroll; location shown is the payroll_location.
      if (rule.rule_type === 'PAY_UNDER_OTHER_LOCATION') {
        payrollHours    = actual;
        cashHours       = 0;
        payrollAmount   = round(actual * wage);
        cashAmount      = 0;
        payrollLocation = rule.payroll_location || first.location;
        notes           = `Paid under: ${payrollLocation}. ${notes}`.trim();
      }

      // ── NOTE_ONLY ─────────────────────────────────────────────────
      if (rule.rule_type === 'NOTE_ONLY') {
        // No changes to hours/pay — just attach the note
        payrollHours  = actual;
        cashHours     = 0;
        payrollAmount = round(actual * wage);
        cashAmount    = 0;
      }
    }

    rows.push({
      employee_name:  first.employee_name,
      location:       payrollLocation,
      department:     first.department,
      role:           first.role,
      actual_hours:   actual,
      payroll_hours:  payrollHours,
      cash_hours:     cashHours,
      wage,
      payroll_amount: payrollAmount,
      cash_amount:    cashAmount,
      rule_applied:   ruleApplied,
      notes,
    });
  }

  return rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

export function summarize(rows: PayrollRow[]) {
  return {
    employees:     rows.length,
    totalHours:    round(rows.reduce((s, r) => s + r.actual_hours,   0)),
    payrollHours:  round(rows.reduce((s, r) => s + r.payroll_hours,  0)),
    cashHours:     round(rows.reduce((s, r) => s + r.cash_hours,     0)),
    payrollAmount: round(rows.reduce((s, r) => s + r.payroll_amount, 0)),
    cashAmount:    round(rows.reduce((s, r) => s + r.cash_amount,    0)),
    exceptions:    rows.filter((r) => r.rule_applied !== 'STANDARD').length,
  };
}
