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

function employeeKey(punch: PunchRow) {
  return punch.employee_id || (punch.seven_shifts_user_id ? `7S-${punch.seven_shifts_user_id}` : punch.employee_name);
}

function alertRecordId(alert: PayrollAlert) {
  return `${alert.type}|${alert.employee_id}|${alert.alert_date}|${alert.location}`;
}

function buildAlerts(punches: PunchRow[]) {
  const alerts: PayrollAlert[] = [];
  const daily = new Map<string, { hours: number; employee_id: string; employee_name: string; date: string; locations: Set<string>; punches: number }>();

  for (const punch of punches) {
    if (!punch.clocked_in) continue;
    const inParts = localParts(punch.clocked_in);
    const outParts = punch.clocked_out ? localParts(punch.clocked_out) : null;
    const id = employeeKey(punch);
    const location = punch.location || 'Unknown';
    const gross = Number(punch.gross_hours || punch.payroll_hours || 0);
    const dailyKey = `${id}|${inParts.date}`;
    const row = daily.get(dailyKey) || { hours: 0, employee_id: id, employee_name: punch.employee_name, date: inParts.date, locations: new Set<string>(), punches: 0 };
    row.hours += Number.isFinite(gross) ? gross : 0;
    row.locations.add(location);
    row.punches += 1;
    daily.set(dailyKey, row);

    const crossesMidnight = Boolean(outParts && outParts.date !== inParts.date);
    const earlyIn = inParts.hour >= 0 && inParts.hour < 7;
    const earlyOut = Boolean(outParts && outParts.hour >= 0 && outParts.hour < 7);
    if (!crossesMidnight && !earlyIn && !earlyOut) continue;

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
      message: `Punch touches 12:00am–7:00am or crosses midnight: ${timeWindow}.`,
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
      new_value: alert.details,
      notes: alert.message,
    }));
  if (!inserts.length) return [];
  const { error } = await supabase.from('audit_log').insert(inserts);
  if (error) throw error;
  return inserts;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date();
    const days = Math.max(1, Math.min(31, Number(sp.get('days') || 7)));
    const from = sp.get('from') || isoDate(new Date(today.getTime() - (days - 1) * DAY_MS));
    const to = sp.get('to') || isoDate(today);
    const employee = (sp.get('employee') || '').trim().toLowerCase();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('punches')
      .select('punch_id, employee_id, seven_shifts_user_id, employee_name, location, role, clocked_in, clocked_out, gross_hours, payroll_hours')
      .gte('clocked_in', `${from}T00:00:00.000Z`)
      .lte('clocked_in', `${to}T23:59:59.999Z`)
      .order('clocked_in', { ascending: false })
      .limit(5000);
    if (error) throw error;
    const filtered = employee
      ? (data || []).filter((row: PunchRow) => row.employee_name?.toLowerCase().includes(employee) || employeeKey(row).toLowerCase() === employee)
      : (data || []);
    const alerts = buildAlerts(filtered as PunchRow[]);
    await saveAlerts(supabase, alerts);
    return NextResponse.json({ alerts, from, to, saved: true });
  } catch (error: any) {
    return NextResponse.json({ alerts: [], saved: false, error: error.message }, { status: 500 });
  }
}
