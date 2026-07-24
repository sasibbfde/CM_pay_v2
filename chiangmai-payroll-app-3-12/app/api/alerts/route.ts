import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

type PunchRow = {
  punch_id: string | null;
  employee_id: string | null;
  seven_shifts_user_id: string | null;
  employee_name: string;
  location: string;
  role: string | null;
  clocked_in: string;
  clocked_out: string | null;
  gross_hours: number | string | null;
  payroll_hours: number | string | null;
};

type PayrollAlert = {
  id: string;
  type: 'OVERNIGHT_PUNCH' | 'DAILY_OVER_14_HOURS';
  employee_id: string;
  employee_name: string;
  location: string;
  alert_date: string;
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  created_at?: string;
};

const TORONTO_TZ = 'America/Toronto';
const DAY_MS = 24 * 60 * 60 * 1000;
const OVERNIGHT_ALERT_START_MINUTE = 5; // 12:05am Toronto time
const OVERNIGHT_ALERT_END_HOUR = 7; // 7:00am Toronto time

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function localParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute')),
  };
}

function localTimeLabel(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function minuteOfDay(parts: { hour: number; minute: number }) {
  return parts.hour * 60 + parts.minute;
}

function isInOvernightAlertWindow(parts: { hour: number; minute: number }) {
  const minute = minuteOfDay(parts);
  return minute >= OVERNIGHT_ALERT_START_MINUTE && minute < OVERNIGHT_ALERT_END_HOUR * 60;
}

function touchesOvernightAlertWindow(
  inParts: { date: string; hour: number; minute: number },
  outParts: { date: string; hour: number; minute: number } | null,
) {
  const startMinute = minuteOfDay(inParts);
  const endMinute = outParts ? minuteOfDay(outParts) : startMinute;
  const windowStart = OVERNIGHT_ALERT_START_MINUTE;
  const windowEnd = OVERNIGHT_ALERT_END_HOUR * 60;

  if (!outParts || outParts.date === inParts.date) {
    return startMinute < windowEnd && endMinute > windowStart;
  }

  return isInOvernightAlertWindow(inParts) || endMinute > windowStart;
}

function employeeKey(punch: PunchRow) {
  return punch.employee_id || (punch.seven_shifts_user_id ? `7S-${punch.seven_shifts_user_id}` : punch.employee_name);
}

function alertRecordId(alert: PayrollAlert) {
  return `${alert.type}|${alert.employee_id}|${alert.alert_date}|${alert.location}`;
}

function parseAlertRecordId(recordId: string | null | undefined) {
  const [type, employee_id, alert_date, ...locationParts] = String(recordId || '').split('|');
  if (!type || !employee_id || !alert_date) return null;
  if (type !== 'OVERNIGHT_PUNCH' && type !== 'DAILY_OVER_14_HOURS') return null;
  return {
    type: type as PayrollAlert['type'],
    employee_id,
    alert_date,
    location: locationParts.join('|') || 'Unknown',
  };
}

function timestampGrossHours(punch: PunchRow) {
  if (!punch.clocked_in || !punch.clocked_out) return 0;
  const start = new Date(punch.clocked_in).getTime();
  const end = new Date(punch.clocked_out).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

function alertGrossHours(punch: PunchRow) {
  const storedGross = Number(punch.gross_hours || 0);
  const storedPayroll = Number(punch.payroll_hours || 0);
  const timestampGross = timestampGrossHours(punch);
  const grossCandidates = [
    Number.isFinite(storedGross) ? storedGross : 0,
    timestampGross,
  ].filter(value => value > 0);
  if (grossCandidates.length) return Math.max(...grossCandidates);
  return Number.isFinite(storedPayroll) ? storedPayroll : 0;
}

export function buildAlerts(punches: PunchRow[]) {
  const alerts: PayrollAlert[] = [];
  const daily = new Map<string, { hours: number; employee_id: string; employee_name: string; date: string; locations: Set<string>; punches: number }>();

  for (const punch of punches) {
    if (!punch.clocked_in) continue;
    const inParts = localParts(punch.clocked_in);
    const outParts = punch.clocked_out ? localParts(punch.clocked_out) : null;
    const id = employeeKey(punch);
    const location = punch.location || 'Unknown';
    const gross = alertGrossHours(punch);
    const dailyKey = `${id}|${inParts.date}`;
    const row = daily.get(dailyKey) || { hours: 0, employee_id: id, employee_name: punch.employee_name, date: inParts.date, locations: new Set<string>(), punches: 0 };
    row.hours += Number.isFinite(gross) ? gross : 0;
    row.locations.add(location);
    row.punches += 1;
    daily.set(dailyKey, row);

    if (!touchesOvernightAlertWindow(inParts,outParts)) continue;

    const timeWindow = punch.clocked_out
      ? `${localTimeLabel(punch.clocked_in)} → ${localTimeLabel(punch.clocked_out)}`
      : `${localTimeLabel(punch.clocked_in)} → still clocked in`;
    alerts.push({
      id: alertRecordId({
        type: 'OVERNIGHT_PUNCH',
        employee_id: id,
        employee_name: punch.employee_name,
        location,
        alert_date: inParts.date,
        severity: 'warning',
        message: '',
        details: {},
      } as PayrollAlert),
      type: 'OVERNIGHT_PUNCH',
      employee_id: id,
      employee_name: punch.employee_name,
      location,
      alert_date: inParts.date,
      severity: 'warning',
      message: `Punch touches 12:05am–7:00am: ${timeWindow}.`,
      details: {
        punch_id: punch.punch_id,
        clocked_in: punch.clocked_in,
        clocked_out: punch.clocked_out,
        gross_hours: gross,
        role: punch.role,
      },
    });
  }

  for (const row of daily.values()) {
    if (row.hours <= 14) continue;
    const location = [...row.locations].join('; ');
    const alert: PayrollAlert = {
      id: '',
      type: 'DAILY_OVER_14_HOURS',
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      location,
      alert_date: row.date,
      severity: 'critical',
      message: `${row.employee_name} worked ${row.hours.toFixed(2)} gross hours on ${row.date} across ${row.punches} punch${row.punches === 1 ? '' : 'es'}.`,
      details: {
        gross_hours: Number(row.hours.toFixed(2)),
        locations: [...row.locations],
        punches: row.punches,
      },
    };
    alert.id = alertRecordId(alert);
    alerts.push(alert);
  }

  const unique = new Map<string, PayrollAlert>();
  for (const alert of alerts) unique.set(alert.id, alert);
  return [...unique.values()].sort((a, b) => `${b.alert_date}|${b.severity}`.localeCompare(`${a.alert_date}|${a.severity}`));
}

async function saveAlerts(supabase: any, alerts: PayrollAlert[]) {
  if (!alerts.length) return [];
  const ids = alerts.map(alert => alert.id);
  const { data: existing, error: existingError } = await supabase
    .from('audit_log')
    .select('record_id')
    .eq('action', 'payroll_alert')
    .in('record_id', ids);
  if (existingError) throw existingError;
  const seen = new Set((existing || []).map((row: any) => row.record_id));
  const inserts = alerts
    .filter(alert => !seen.has(alert.id))
    .map(alert => ({
      action: 'payroll_alert',
      table_name: 'punches',
      record_id: alert.id,
      new_value: {
        ...alert.details,
        type: alert.type,
        employee_id: alert.employee_id,
        employee_name: alert.employee_name,
        location: alert.location,
        alert_date: alert.alert_date,
        severity: alert.severity,
        message: alert.message,
      },
      notes: alert.message,
    }));
  if (!inserts.length) return [];
  const { error } = await supabase.from('audit_log').insert(inserts);
  if (error) throw error;
  return inserts;
}

async function readSavedAlerts(supabase: any, from: string, to: string, employee = '') {
  const { data, error } = await supabase
    .from('audit_log')
    .select('record_id, new_value, notes, created_at')
    .eq('action', 'payroll_alert')
    .order('created_at', { ascending: false })
    .limit(10000);
  if (error) throw error;

  const alerts: PayrollAlert[] = [];
  for (const row of data || []) {
    const parsed = parseAlertRecordId(row.record_id);
    const saved = row.new_value || {};
    const alertDate = String(saved.alert_date || parsed?.alert_date || '');
    if (!alertDate || alertDate < from || alertDate > to) continue;

    const employeeName = String(saved.employee_name || parsed?.employee_id || 'Unknown employee');
    const employeeId = String(saved.employee_id || parsed?.employee_id || employeeName);
    const location = String(saved.location || parsed?.location || 'Unknown');
    const type = (saved.type || parsed?.type) as PayrollAlert['type'] | undefined;
    if (!type) continue;
    if (employee) {
      const needle = employee.toLowerCase();
      if (!employeeName.toLowerCase().includes(needle) && employeeId.toLowerCase() !== needle) continue;
    }

    alerts.push({
      id: String(row.record_id || alertRecordId({
        id: '',
        type,
        employee_id: employeeId,
        employee_name: employeeName,
        location,
        alert_date: alertDate,
        severity: type === 'DAILY_OVER_14_HOURS' ? 'critical' : 'warning',
        message: String(row.notes || saved.message || ''),
        details: {},
      })),
      type,
      employee_id: employeeId,
      employee_name: employeeName,
      location,
      alert_date: alertDate,
      severity: (saved.severity === 'critical' || saved.severity === 'warning')
        ? saved.severity
        : type === 'DAILY_OVER_14_HOURS' ? 'critical' : 'warning',
      message: String(saved.message || row.notes || ''),
      details: saved,
      created_at: row.created_at,
    });
  }
  return alerts;
}

async function fetchPunchesInRange(supabase: any, startIso: string, endIso: string) {
  const all: PunchRow[] = [];
  const pageSize = 1000;
  for (let fromIndex = 0; ; fromIndex += pageSize) {
    const { data, error } = await supabase
      .from('punches')
      .select('punch_id, employee_id, seven_shifts_user_id, employee_name, location, role, clocked_in, clocked_out, gross_hours, payroll_hours')
      .gte('clocked_in', startIso)
      .lte('clocked_in', endIso)
      .order('clocked_in', { ascending: false })
      .range(fromIndex, fromIndex + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as PunchRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date();
    const days = Math.max(1, Math.min(31, Number(sp.get('days') || 7)));
    const from = sp.get('from') || isoDate(new Date(today.getTime() - (days - 1) * DAY_MS));
    const to = sp.get('to') || isoDate(today);
    const employee = (sp.get('employee') || '').trim().toLowerCase();
    const queryStart = new Date(`${from}T00:00:00.000Z`);
    queryStart.setUTCDate(queryStart.getUTCDate() - 1);
    const queryEnd = new Date(`${to}T23:59:59.999Z`);
    queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);
    const supabase = getSupabaseAdmin();
    const data = await fetchPunchesInRange(supabase, queryStart.toISOString(), queryEnd.toISOString());
    const ranged = data.filter((row: PunchRow) => {
      if (!row.clocked_in) return false;
      const localDate = localParts(row.clocked_in).date;
      return localDate >= from && localDate <= to;
    });
    const filtered = employee
      ? ranged.filter((row: PunchRow) => row.employee_name?.toLowerCase().includes(employee) || employeeKey(row).toLowerCase() === employee)
      : ranged;
    const computedAlerts = buildAlerts(filtered as PunchRow[]);
    const inserted = await saveAlerts(supabase, computedAlerts);
    const savedAlerts = await readSavedAlerts(supabase, from, to, employee);
    const merged = new Map<string, PayrollAlert>();
    for (const alert of savedAlerts) merged.set(alert.id, alert);
    for (const alert of computedAlerts) merged.set(alert.id, alert);
    const alerts = [...merged.values()].sort((a, b) => `${b.alert_date}|${b.severity}|${b.employee_name}`.localeCompare(`${a.alert_date}|${a.severity}|${a.employee_name}`));
    return NextResponse.json({ alerts, from, to, saved: true, inserted: inserted.length, punch_rows: filtered.length });
  } catch (error: any) {
    return NextResponse.json({ alerts: [], saved: false, error: error.message }, { status: 500 });
  }
}
