export type BreakTotals = {
  breakMinutes: number;
  unpaidMinutes: number;
  paidMinutes: number;
};

function breakTime(value: any, names: string[]) {
  for (const name of names) {
    if (value?.[name]) return value[name];
  }
  return null;
}

/** Normalize every break shape currently returned by 7shifts punch APIs. */
export function calculateBreaks(breaks: any[]): BreakTotals {
  let unpaidMinutes = 0;
  let paidMinutes = 0;

  for (const item of breaks || []) {
    const start = breakTime(item, ['in', 'clocked_in', 'break_in', 'start']);
    const end = breakTime(item, ['out', 'clocked_out', 'break_out', 'end']);
    if (!start || !end) continue;
    const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) continue;
    if (item.paid === true || item.is_paid === true) paidMinutes += minutes;
    else unpaidMinutes += minutes;
  }

  return {
    breakMinutes: unpaidMinutes + paidMinutes,
    unpaidMinutes,
    paidMinutes,
  };
}

export function calculateGrossHours(clockIn: string | null, clockOut: string | null) {
  if (!clockIn || !clockOut) return 0;
  const hours = (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000;
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 100) / 100 : 0;
}

export function calculatePayrollHours(grossHours: number, unpaidMinutes: number) {
  return Math.max(0, Math.round((grossHours - unpaidMinutes / 60) * 100) / 100);
}
