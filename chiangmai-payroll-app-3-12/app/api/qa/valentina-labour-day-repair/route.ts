import { NextResponse } from 'next/server';
import { fetchHoursAndWages } from '@/lib/7shifts';
import { flattenHoursAndWagesReport } from '@/lib/hours-wages';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPayrollDate } from '@/lib/payroll';

export const maxDuration = 120;

const employeeName = 'Valentina Lozano Bejarano';
const start = '2026-09-01';
const end = '2026-09-15';
const labourDay = '2026-09-07';
const extraHours = 6.87;
const expectedShiftHours = 6.92;
const tolerance = 0.02;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const nameKey = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isValentina = (value?: string | null) => nameKey(value).includes('valentinalozanobejarano');
const near = (left: number, right: number) => Math.abs(left - right) <= tolerance;

function countableEntry(entry: any) {
  const payable = Number(entry.regular_hours ?? entry.gross_hours ?? 0);
  const date = entry.date || String(entry.clocked_in || '').slice(0, 10);
  return isValentina(entry.employee_name) && date === labourDay && Number.isFinite(payable) && payable > 0;
}

function summarizeSevenShifts(report: any) {
  return flattenHoursAndWagesReport(report)
    .filter(countableEntry)
    .map((entry: any) => ({
      date: entry.date || String(entry.clocked_in || '').slice(0, 10),
      employee_name: entry.employee_name,
      location: entry.location || entry.location_name || entry.location_id || '',
      clocked_in: entry.clocked_in || '',
      clocked_out: entry.clocked_out || '',
      regular_hours: round2(Number(entry.regular_hours ?? entry.gross_hours ?? 0)),
      gross_hours: round2(Number(entry.gross_hours ?? entry.regular_hours ?? 0)),
      break_minutes: Number(entry.break_minutes || 0),
      shift_details: entry.shift_details || '',
      punch_id: entry.punch_id || '',
    }));
}

async function loadStoredRows() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('punches')
    .select('id,punch_id,employee_id,seven_shifts_user_id,employee_name,location,clocked_in,clocked_out,hours,payroll_hours,gross_hours,break_minutes,source,punch_source')
    .ilike('employee_name', '%Valentina%')
    .gte('clocked_in', '2026-08-31T00:00:00.000Z')
    .lte('clocked_in', '2026-09-16T23:59:59.999Z')
    .order('clocked_in');
  if (error) throw error;
  return (data || [])
    .map(row => ({ ...row, payroll_date: getPayrollDate(row.clocked_in), payable_hours: round2(Number(row.payroll_hours ?? row.hours ?? 0)) }))
    .filter(row => row.payroll_date >= start && row.payroll_date <= end);
}

export async function GET() {
  try {
    const [storedRows, sevenReport] = await Promise.all([
      loadStoredRows(),
      fetchHoursAndWages(start, end),
    ]);
    const sevenLabourDayRows = summarizeSevenShifts(sevenReport);
    const storedLabourDayRows = storedRows.filter(row => row.payroll_date === labourDay);
    const candidates = storedLabourDayRows.filter(row => near(row.payable_hours, extraHours));
    const expectedRows = storedLabourDayRows.filter(row => near(row.payable_hours, expectedShiftHours));
    const sevenHasExpected = sevenLabourDayRows.some(row => near(row.regular_hours, expectedShiftHours));
    const sevenHasExtra = sevenLabourDayRows.some(row => near(row.regular_hours, extraHours));
    const safeToDelete = candidates.length === 1 && expectedRows.length >= 1 && sevenHasExpected && !sevenHasExtra;

    return NextResponse.json({
      ok: true,
      mode: 'dry-run-only',
      employee: employeeName,
      period: { start, end },
      stored_total_hours_before: round2(storedRows.reduce((sum, row) => sum + row.payable_hours, 0)),
      stored_total_hours_after_if_applied: safeToDelete ? round2(storedRows.reduce((sum, row) => sum + row.payable_hours, 0) - candidates[0].payable_hours) : null,
      seven_labour_day_rows: sevenLabourDayRows,
      stored_labour_day_rows: storedLabourDayRows,
      candidate_rows_to_delete: candidates,
      safety: { safeToDelete, expectedRows: expectedRows.length, sevenHasExpected, sevenHasExtra },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Repair failed' }, { status: 500 });
  }
}
