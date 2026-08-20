import { NextRequest, NextResponse } from 'next/server';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fillMissingRosterDetails } from '@/lib/roster-details';
import { applyCashWage } from '@/lib/cash-rates';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TORONTO_TZ = 'America/Toronto';

const round2 = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const money = (value: number) => `$${round2(value).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function torontoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) };
}

function currentPayrollPeriod() {
  const { year, month, day } = torontoParts();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day <= 15) return { start: `${prefix}-01`, end: `${prefix}-15`, label: `${prefix} 1–15` };
  return { start: `${prefix}-16`, end: `${prefix}-${String(lastDay).padStart(2, '0')}`, label: `${prefix} 16–End` };
}

function normalize(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensFromPrompt(message: string) {
  const ignored = new Set([
    'show', 'tell', 'give', 'find', 'what', 'when', 'where', 'why', 'how', 'hours', 'hour', 'wage', 'wages',
    'salary', 'manager', 'managers', 'employee', 'employees', 'payroll', 'cash', 'cheque', 'check', 'please',
    'report', 'excel', 'pdf', 'location', 'locations', 'rule', 'rules', 'bonus', 'period', 'month',
  ]);
  return normalize(message).split(/\s+/).filter(token => token.length >= 3 && !ignored.has(token)).slice(0, 12);
}

async function fetchAll(supabase: any, table: string, columns: string, filter?: (query: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns).range(from, from + 999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function compactPayrollRows(rows: any[], promptTokens: string[]) {
  const hasMatch = (row: any) => {
    if (!promptTokens.length) return false;
    const haystack = normalize([
      row.employee_name,
      row.locations?.join(' '),
      row.roles?.join(' '),
      row.status,
      row.employee_labels?.join(' '),
    ].join(' '));
    return promptTokens.some(token => haystack.includes(token));
  };

  const matching = rows.filter(hasMatch).slice(0, 30);
  const managers = rows
    .filter(row => (row.roles || []).some((role: string) => /manager/i.test(role)))
    .sort((a, b) => Number(b.payable_hours || 0) - Number(a.payable_hours || 0))
    .slice(0, 35);
  const multiLocation = rows
    .filter(row => (row.locations || []).length > 1)
    .sort((a, b) => Number(b.payable_hours || 0) - Number(a.payable_hours || 0))
    .slice(0, 30);
  const risks = rows
    .filter(row => Number(row.cash_hours || 0) > 0 || (row.daily_over_14_alerts || []).length || String(row.status || '').trim())
    .sort((a, b) => Number(b.cash_hours || 0) - Number(a.cash_hours || 0))
    .slice(0, 40);

  const compact = (row: any) => ({
    name: row.employee_name,
    locations: row.locations,
    roles: row.roles,
    wage: row.wage,
    cash_wage: row.cash_wage,
    gross_hours: row.gross_hours,
    payable_hours: row.payable_hours,
    cheque_hours: row.cheque_hours,
    cash_hours: row.cash_hours,
    cheque_pay: row.cheque_pay,
    cash_pay: row.cash_pay,
    total_pay: row.total_pay,
    labels: row.employee_labels,
    status: row.status,
    location_hours: row.location_hours,
    location_gross_hours: row.location_gross_hours,
    notes: row.notes,
  });

  return {
    matching_employees: matching.map(compact),
    manager_hours: managers.map(compact),
    multi_location: multiLocation.map(compact),
    risk_rows: risks.map(compact),
  };
}

function lineForEmployee(row: any) {
  const locations = Array.isArray(row.locations) ? row.locations.join(', ') : '';
  const roles = Array.isArray(row.roles) ? row.roles.join(', ') : '';
  const labels = Array.isArray(row.labels) && row.labels.length ? ` · labels: ${row.labels.join(', ')}` : '';
  const locationHours = row.location_hours && Object.keys(row.location_hours).length > 1
    ? ` · split: ${Object.entries(row.location_hours).map(([location, hours]) => `${location} ${round2(Number(hours))}h`).join(' / ')}`
    : '';
  return `- ${row.name}: ${round2(row.payable_hours)} payable h, ${round2(row.cheque_hours)} cheque h, ${round2(row.cash_hours)} cash h, wage $${round2(row.wage)}/hr · ${locations}${roles ? ` · ${roles}` : ''}${locationHours}${labels}`;
}

function answerFromPrivateContext(message: string, context: Awaited<ReturnType<typeof buildCmPayContext>>) {
  const prompt = normalize(message);
  const period = `${context.selected_period.start} → ${context.selected_period.end}`;
  const source = `Source: CM Pay V2 stored payroll rows for ${period}.`;
  const rows = context.payroll_rows;

  if (/export|excel|pdf|download/.test(prompt)) {
    return [
      `${source}`,
      'I can summarize the data here, but this first AI Agent version does not create Excel/PDF files yet.',
      'Use the existing Export buttons in Payroll Hours, Wages, Insights, Command Center, or Manager Bonus for approved downloadable reports.',
    ].join('\n');
  }

  if (/change|update|edit|save|delete|remove|add/.test(prompt) && /rule|wage|employee|payroll|salary|cash|cheque/.test(prompt)) {
    return [
      `${source}`,
      'I cannot change payroll data from this chat. That protects payroll logic from accidental edits.',
      'Use Wages for wage/rule edits, Employee Management for employee status, and Payroll Hours for period review/export. After you save there, ask me to explain or verify the result.',
    ].join('\n');
  }

  if (/manager|bonus/.test(prompt)) {
    const managers = rows.manager_hours;
    if (!managers.length) return `${source}\nI do not see manager rows in the current payroll context. Sync the correct period if this looks wrong.`;
    return [
      `${source}`,
      'Manager hours and wages:',
      ...managers.slice(0, 18).map(lineForEmployee),
      managers.length > 18 ? `...and ${managers.length - 18} more manager rows.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/multi|multiple|two location|split/.test(prompt)) {
    const multi = rows.multi_location;
    if (!multi.length) return `${source}\nNo multi-location employees were found in the current payroll context.`;
    return [
      `${source}`,
      'Multi-location employees are shown by actual worked location. Payroll Hours keeps the label and location split:',
      ...multi.slice(0, 18).map(lineForEmployee),
      multi.length > 18 ? `...and ${multi.length - 18} more multi-location rows.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/missing/.test(prompt) && /wage|salary|rate/.test(prompt)) {
    if (!context.missing_wages.length) return `${source}\nNo active employees with missing cheque wage were found in the employee table.`;
    return [
      `${source}`,
      'Employees missing cheque wage:',
      ...context.missing_wages.map(row => `- ${row.name}: ${row.location || 'No location'} · ${row.role || 'No role'}`),
    ].join('\n');
  }

  if (/wage|salary|rate/.test(prompt)) {
    const employeeMatches = context.employee_matches;
    const wageHistory = context.recent_wage_history;
    if (employeeMatches.length) {
      return [
        `${source}`,
        'Matched employee wages:',
        ...employeeMatches.slice(0, 18).map(row => `- ${row.name}: cheque $${round2(row.wage)}/hr, cash $${round2(row.cash_wage || row.wage)}/hr · ${row.location || 'No location'} · ${row.role || row.department || 'No role'} · ${row.active ? 'Active' : 'Inactive'}`),
      ].join('\n');
    }
    return [
      `${source}`,
      wageHistory.length ? 'Recent wage history:' : 'No recent wage-history rows are available.',
      ...wageHistory.slice(0, 15).map(row => `- ${row.employee}: $${round2(row.old_wage)} → $${round2(row.new_wage)} · ${row.effective_date || String(row.detected_at || '').slice(0, 10)} · ${row.source || 'saved history'}`),
    ].join('\n');
  }

  if (/rule|cash only|cap|hold|exception/.test(prompt)) {
    const rules = context.active_rules;
    if (!rules.length) return `${source}\nNo active employee rules were found.`;
    return [
      `${source}`,
      'Active payroll rules:',
      ...rules.slice(0, 22).map(rule => `- ${rule.employee}: ${rule.type}${rule.value !== null && rule.value !== undefined ? ` ${rule.value}` : ''}${rule.cash_locations ? ` · cash locations: ${rule.cash_locations}` : ''}${rule.payroll_location ? ` · payroll location: ${rule.payroll_location}` : ''}${rule.notes ? ` · ${rule.notes}` : ''}`),
      rules.length > 22 ? `...and ${rules.length - 22} more active rules.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/cash|cheque|check|total|summary|pay/.test(prompt)) {
    const summary = context.payroll_summary;
    return [
      `${source}`,
      'Current payroll summary:',
      `- Employees: ${summary.employees}`,
      `- Gross hours: ${summary.gross_hours}h`,
      `- Payable hours: ${summary.payable_hours}h`,
      `- Cheque hours: ${summary.cheque_hours}h`,
      `- Cash hours: ${summary.cash_hours}h`,
      `- Cheque pay: ${summary.cheque_pay}`,
      `- Cash pay: ${summary.cash_pay}`,
      `- Holiday pay: ${summary.holiday_pay}`,
      `- Total pay: ${summary.total_pay}`,
    ].join('\n');
  }

  if (rows.matching_employees.length) {
    return [
      `${source}`,
      'Matched payroll rows:',
      ...rows.matching_employees.slice(0, 18).map(lineForEmployee),
    ].join('\n');
  }

  const riskRows = rows.risk_rows.slice(0, 12);
  return [
    `${source}`,
    'I can answer CM Pay V2 questions about employee hours, wages, manager hours, multi-location staff, rules, missing wages, and cheque/cash summaries.',
    'Try: “show manager hours”, “show multi-location employees”, “wage for Steven Lin”, or “cash and cheque summary”.',
    riskRows.length ? '\nCurrent review rows:' : '',
    ...riskRows.map(lineForEmployee),
  ].filter(Boolean).join('\n');
}

async function buildCmPayContext(message: string) {
  const period = currentPayrollPeriod();
  const promptTokens = tokensFromPrompt(message);
  const supabase = getSupabaseAdmin();
  const [report, rawEmployees, rawRules, rawWageHistory] = await Promise.all([
    getPayrollReport(period.start, period.end),
    fetchAll(
      supabase,
      'employees',
      'employee_id,seven_shifts_user_id,full_name,location,department,role,wage,cash_wage,wage_source,active,created_at',
      query => query.order('full_name'),
    ),
    fetchAll(
      supabase,
      'employee_rules',
      'employee_id,employee_name,rule_type,rule_value,combined_locations,payroll_location,notes,active,effective_from,effective_to',
      query => query.eq('active', true).order('employee_name'),
    ),
    fetchAll(
      supabase,
      'employee_wage_history',
      'employee_id,employee_name,location,role,old_wage,new_wage,effective_date,detected_at,source,notes',
      query => query.order('detected_at', { ascending: false }).limit(120),
    ).catch(() => []),
  ]);

  const employees = rawEmployees.map(fillMissingRosterDetails).map(applyCashWage);
  const normalizedTokens = promptTokens;
  const matchedEmployees = employees
    .filter((employee: any) => {
      if (!normalizedTokens.length) return false;
      const haystack = normalize(`${employee.full_name} ${employee.location} ${employee.department} ${employee.role}`);
      return normalizedTokens.some(token => haystack.includes(token));
    })
    .slice(0, 35)
    .map((employee: any) => ({
      name: employee.full_name,
      location: employee.location,
      department: employee.department,
      role: employee.role,
      wage: employee.wage,
      cash_wage: employee.cash_wage,
      wage_source: employee.wage_source,
      active: employee.active !== false,
      created_at: employee.created_at,
    }));

  const missingWages = employees
    .filter((employee: any) => employee.active !== false && !Number(employee.wage || 0))
    .slice(0, 30)
    .map((employee: any) => ({ name: employee.full_name, location: employee.location, role: employee.role }));

  const activeRules = rawRules.slice(0, 80).map((rule: any) => ({
    employee: rule.employee_name,
    type: rule.rule_type,
    value: rule.rule_value,
    cash_locations: rule.combined_locations,
    payroll_location: rule.payroll_location,
    notes: rule.notes,
  }));

  const wageHistory = rawWageHistory.slice(0, 40).map((row: any) => ({
    employee: row.employee_name,
    location: row.location,
    role: row.role,
    old_wage: row.old_wage,
    new_wage: row.new_wage,
    effective_date: row.effective_date,
    detected_at: row.detected_at,
    source: row.source,
    notes: row.notes,
  }));

  return {
    generated_at_toronto: new Intl.DateTimeFormat('en-CA', {
      timeZone: TORONTO_TZ,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date()),
    selected_period: period,
    payroll_summary: {
      employees: report.summary.employees,
      gross_hours: report.summary.gross_hours,
      payable_hours: report.summary.payable_hours,
      cheque_hours: report.summary.cheque_hours,
      cash_hours: report.summary.cash_hours,
      cheque_pay: money(report.summary.cheque_pay),
      cash_pay: money(report.summary.cash_pay),
      holiday_pay: money(report.summary.holiday_pay),
      total_pay: money(report.summary.total_pay),
    },
    payroll_rows: compactPayrollRows(report.rows, promptTokens),
    employee_matches: matchedEmployees,
    missing_wages: missingWages,
    active_rules: activeRules,
    recent_wage_history: wageHistory,
    guardrails: [
      'This context is read-only.',
      'Payroll Hours calculation code is not changed by this assistant.',
      'If the user asks to change wages, rules, employee status, payroll, or code, refuse to perform the change and direct them to Wages/Employee Management or ask for owner approval outside this chat.',
      'If a requested fact is not in the context, say the app does not have enough data in this answer and recommend syncing the correct period or using the relevant tab.',
    ],
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = String(body.message || '').trim();
    if (!message) return NextResponse.json({ ok: false, error: 'Ask the AI Agent a CM Pay V2 question.' }, { status: 400 });
    if (message.length > 1200) return NextResponse.json({ ok: false, error: 'Please keep one question under 1,200 characters.' }, { status: 400 });

    const context = await buildCmPayContext(message);
    return NextResponse.json({
      ok: true,
      answer: answerFromPrivateContext(message, context),
      mode: 'private-local-payroll-agent',
      privacy: 'Payroll names, wages, hours, and rules were processed inside CM Pay V2 only and were not sent to Groq.',
      period: context.selected_period,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'AI Agent failed.' }, { status: 500 });
  }
}
