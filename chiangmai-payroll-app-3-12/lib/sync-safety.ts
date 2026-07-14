import { getPayrollDate } from './payroll';

type PunchLike = {
  clocked_in?: string | null;
  payroll_hours?: number | string | null;
  hours?: number | string | null;
  gross_hours?: number | string | null;
  break_minutes?: number | string | null;
};

export type SyncSafetyTotals = {
  rows: number;
  payrollHours: number;
  grossHours: number;
  breakHours: number;
};

export type SyncSafetyResult = {
  ok: boolean;
  reason?: string;
  existing: SyncSafetyTotals;
  incoming: SyncSafetyTotals;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function summarizeSyncRows(rows: PunchLike[], start: string, end: string): SyncSafetyTotals {
  return rows.reduce((sum, row) => {
    const date = row.clocked_in ? getPayrollDate(row.clocked_in) : '';
    if (!date || date < start || date > end) return sum;
    return {
      rows: sum.rows + 1,
      payrollHours: round2(sum.payrollHours + number(row.payroll_hours ?? row.hours)),
      grossHours: round2(sum.grossHours + (number(row.gross_hours) || number(row.payroll_hours ?? row.hours))),
      breakHours: round2(sum.breakHours + number(row.break_minutes) / 60),
    };
  }, { rows: 0, payrollHours: 0, grossHours: 0, breakHours: 0 });
}

export function evaluateSyncSafety(
  existingRows: PunchLike[],
  incomingRows: PunchLike[],
  options: {
    start: string;
    end: string;
    allowDecrease?: boolean;
    expectedPayableHours?: number;
    maxDecreaseRatio?: number;
    expectedToleranceHours?: number;
  },
): SyncSafetyResult {
  const existing = summarizeSyncRows(existingRows, options.start, options.end);
  const incoming = summarizeSyncRows(incomingRows, options.start, options.end);
  const maxDecreaseRatio = options.maxDecreaseRatio ?? 0.02;
  const expected = Number(options.expectedPayableHours || 0);
  const expectedTolerance = options.expectedToleranceHours ?? Math.max(0.25, expected * 0.0025);

  if (expected > 0 && Math.abs(incoming.payrollHours - expected) > expectedTolerance) {
    return {
      ok: false,
      existing,
      incoming,
      reason: `7shifts returned ${incoming.payrollHours.toFixed(2)} payable hours, expected ${expected.toFixed(2)}. Sync stopped so payroll is not overwritten.`,
    };
  }

  if (!options.allowDecrease && existing.payrollHours >= 100) {
    const hourDrop = existing.payrollHours - incoming.payrollHours;
    const rowDrop = existing.rows - incoming.rows;
    const hourDropRatio = hourDrop / existing.payrollHours;
    const rowDropRatio = existing.rows ? rowDrop / existing.rows : 0;

    if (hourDrop > 0.25 && hourDropRatio > maxDecreaseRatio) {
      return {
        ok: false,
        existing,
        incoming,
        reason: `Incoming 7shifts data is ${(hourDropRatio * 100).toFixed(1)}% lower than existing payroll hours (${incoming.payrollHours.toFixed(2)}h vs ${existing.payrollHours.toFixed(2)}h). Sync stopped to protect approved payroll.`,
      };
    }

    if (rowDrop > 10 && rowDropRatio > maxDecreaseRatio * 2) {
      return {
        ok: false,
        existing,
        incoming,
        reason: `Incoming 7shifts data has ${rowDrop} fewer punch rows than existing payroll (${incoming.rows} vs ${existing.rows}). Sync stopped to protect approved payroll.`,
      };
    }
  }

  return { ok: true, existing, incoming };
}
