import { NextRequest, NextResponse } from 'next/server';
import { getPayrollReport } from '@/lib/payroll-report-data';
import { payrollLocationView } from '@/lib/payroll-report';
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

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateFromMessage(message: string) {
  const prompt = message.toLowerCase();
  const todayParts = torontoParts();
  const today = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  if (/\btoday\b/.test(prompt)) return dateString(todayParts.year, todayParts.month, todayParts.day);
  if (/\byesterday\b/.test(prompt)) return addDays(today, -1).toISOString().slice(0, 10);

  const iso = prompt.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return dateString(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const namedMonth = prompt.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/);
  if (namedMonth) {
    const month = MONTH_INDEX[namedMonth[1]];
    const year = Number(namedMonth[3] || todayParts.year);
    return dateString(year, month, Number(namedMonth[2]));
  }

  const slash = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slash) {
    const year = Number(slash[3] || todayParts.year);
    return dateString(year, Number(slash[1]), Number(slash[2]));
  }

  return null;
}

function selectedRangeFromMessage(message: string) {
  const date = parseDateFromMessage(message);
  if (date) return { start: date, end: date, label: date };
  return currentPayrollPeriod();
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

function locationLabourFromRows(rows: any[]) {
  const byLocation = new Map<string, {
    location: string;
    employees: Set<string>;
    gross_hours: number;
    break_hours: number;
    payable_hours: number;
    cheque_hours: number;
    cash_hours: number;
    cheque_pay: number;
    cash_pay: number;
    holiday_pay: number;
    total_pay: number;
  }>();

  for (const row of rows) {
    const locations = Array.isArray(row.locations) && row.locations.length ? row.locations : ['Unknown'];
    for (const location of locations) {
      const local = payrollLocationView(row, location);
      const item = byLocation.get(location) || {
        location,
        employees: new Set<string>(),
        gross_hours: 0,
        break_hours: 0,
        payable_hours: 0,
        cheque_hours: 0,
        cash_hours: 0,
        cheque_pay: 0,
        cash_pay: 0,
        holiday_pay: 0,
        total_pay: 0,
      };
      item.employees.add(row.employee_id || row.employee_name);
      item.gross_hours += Number(local.gross_hours || 0);
      item.break_hours += Number(local.break_hours || 0);
      item.payable_hours += Number(local.payable_hours || 0);
      item.cheque_hours += Number(local.cheque_hours || 0);
      item.cash_hours += Number(local.cash_hours || 0);
      item.cheque_pay += Number(local.cheque_pay || 0);
      item.cash_pay += Number(local.cash_pay || 0);
      item.holiday_pay += Number(local.holiday_pay || 0);
      item.total_pay += Number(local.total_pay || 0);
      byLocation.set(location, item);
    }
  }

  return [...byLocation.values()].map(item => ({
    location: item.location,
    staff: item.employees.size,
    gross_hours: round2(item.gross_hours),
    break_hours: round2(item.break_hours),
    payable_hours: round2(item.payable_hours),
    cheque_hours: round2(item.cheque_hours),
    cash_hours: round2(item.cash_hours),
    cheque_pay: round2(item.cheque_pay),
    cash_pay: round2(item.cash_pay),
    holiday_pay: round2(item.holiday_pay),
    total_pay: round2(item.total_pay),
  })).sort((a, b) => b.total_pay - a.total_pay);
}

function buildManagementInsights(rows: any[], salesRows: any[]) {
  const labourByLocation = locationLabourFromRows(rows);
  const salesByLocation = new Map<string, { sales: number; projected: number; dates: Set<string> }>();
  for (const sale of salesRows || []) {
    const location = String(sale.location || 'Unknown');
    const sales = Number(sale.net_sales ?? sale.gross_sales ?? 0);
    const projected = Number(sale.projected_sales || 0);
    const item = salesByLocation.get(location) || { sales: 0, projected: 0, dates: new Set<string>() };
    item.sales += Number.isFinite(sales) ? sales : 0;
    item.projected += Number.isFinite(projected) ? projected : 0;
    if (sale.sale_date) item.dates.add(String(sale.sale_date));
    salesByLocation.set(location, item);
  }

  const locations = new Set([...labourByLocation.map(row => row.location), ...salesByLocation.keys()]);
  const byLocation = [...locations].map(location => {
    const labour = labourByLocation.find(row => row.location === location);
    const sales = salesByLocation.get(location);
    const totalLabour = Number(labour?.total_pay || 0);
    const actualSales = Number(sales?.sales || 0);
    const labourPercent = actualSales > 0 ? round2((totalLabour / actualSales) * 100) : null;
    return {
      location,
      staff: labour?.staff || 0,
      payable_hours: labour?.payable_hours || 0,
      cheque_hours: labour?.cheque_hours || 0,
      cash_hours: labour?.cash_hours || 0,
      labour_cost: round2(totalLabour),
      sales: round2(actualSales),
      projected_sales: round2(Number(sales?.projected || 0)),
      labour_percent: labourPercent,
      cost_per_payable_hour: labour?.payable_hours ? round2(totalLabour / labour.payable_hours) : 0,
    };
  }).sort((a, b) => (b.labour_percent ?? -1) - (a.labour_percent ?? -1));

  const totalSales = round2(byLocation.reduce((sum, row) => sum + row.sales, 0));
  const totalLabour = round2(byLocation.reduce((sum, row) => sum + row.labour_cost, 0));
  const totalPayableHours = round2(byLocation.reduce((sum, row) => sum + row.payable_hours, 0));
  const totalLabourPercent = totalSales > 0 ? round2((totalLabour / totalSales) * 100) : null;
  const noSalesWithLabour = byLocation.filter(row => row.labour_cost > 0 && row.sales <= 0);
  const highBurden = byLocation.filter(row => row.labour_percent !== null && row.labour_percent > 32);
  const lowBurden = byLocation.filter(row => row.labour_percent !== null && row.labour_percent < 15 && row.labour_cost > 0);

  return {
    total_sales: totalSales,
    total_labour: totalLabour,
    total_payable_hours: totalPayableHours,
    labour_percent: totalLabourPercent,
    by_location: byLocation,
    no_sales_with_labour: noSalesWithLabour,
    high_burden: highBurden,
    low_burden: lowBurden,
  };
}

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? 'not available' : `${round2(value)}%`;
}

function locationInsightLine(row: any) {
  return `- ${row.location}: sales ${money(row.sales)}, labour ${money(row.labour_cost)}, burden ${pct(row.labour_percent)}, payable ${round2(row.payable_hours)}h, staff ${row.staff}`;
}

function answerFromPrivateContext(message: string, context: Awaited<ReturnType<typeof buildCmPayContext>>) {
  const prompt = normalize(message);
  const period = `${context.selected_period.start} → ${context.selected_period.end}`;
  const source = `🤓 Source: CM Pay V2 stored payroll rows for ${period}.`;
  const rows = context.payroll_rows;

  if (/current review/.test(prompt)) {
    return [
      `${source}`,
      '“Current review” is not a separate tab. It means payroll items that need a manager/accountant look before export. 🧐',
      'You can find the same type of items in:',
      '- Command Center: alerts and audit history.',
      '- Payroll Hours: rule labels, multi-location rows, cash/cheque split, over-14.2h labels.',
      '- Wages: active rules, wage changes, missing wages.',
      '- Employee Management: new/active/inactive employees.',
      'In this AI Agent, ask “show review rows” or “show risk exceptions” and I’ll list them. I won’t show them on a normal greeting anymore.',
    ].join('\n');
  }

  if (/budget|burden|labou?r cost|management insight|insights|sales/.test(prompt)) {
    const insights = context.management_insights;
    const lines = [
      `${source}`,
      '📊 Labour burden means: total labour cost ÷ actual sales. It is the same idea as Labour %. Lower is better, but too low can mean understaffing.',
      `- Actual sales: ${money(insights.total_sales)}`,
      `- Labour cost: ${money(insights.total_labour)}`,
      `- Labour burden: ${pct(insights.labour_percent)}`,
      `- Payable hours: ${round2(insights.total_payable_hours)}h`,
    ];

    if (!insights.by_location.length) {
      lines.push('I do not see payroll/sales rows for this date range. Try syncing the selected period first.');
      return lines.join('\n');
    }

    lines.push('\nBy location:');
    lines.push(...insights.by_location.slice(0, 8).map(locationInsightLine));
    if (insights.high_burden.length) lines.push(`\n⚠️ High burden to review: ${insights.high_burden.map((row: any) => `${row.location} ${pct(row.labour_percent)}`).join(', ')}`);
    if (insights.no_sales_with_labour.length) lines.push(`⚠️ Labour exists but sales are missing: ${insights.no_sales_with_labour.map((row: any) => row.location).join(', ')}`);
    if (insights.low_burden.length) lines.push(`🙂 Low burden / possible lean staffing: ${insights.low_burden.map((row: any) => `${row.location} ${pct(row.labour_percent)}`).join(', ')}`);
    return lines.join('\n');
  }

  if (/review|risk|exception|alert|attention/.test(prompt)) {
    const riskRows = rows.risk_rows.slice(0, 18);
    if (!riskRows.length) return `${source}\n✅ I do not see cash hours, rule statuses, or over-14.2h review rows in this period.`;
    return [
      `${source}`,
      '⚠️ Review rows that may need attention:',
      ...riskRows.map(lineForEmployee),
      rows.risk_rows.length > 18 ? `...and ${rows.risk_rows.length - 18} more review rows.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/export|excel|pdf|download/.test(prompt)) {
    return [
      `${source}`,
      '📎 I can summarize the data here, but this first AI Agent version does not create Excel/PDF files yet.',
      'Use the existing Export buttons in Payroll Hours, Wages, Insights, Command Center, or Manager Bonus for approved downloadable reports.',
    ].join('\n');
  }

  if (/change|update|edit|save|delete|remove|add/.test(prompt) && /rule|wage|employee|payroll|salary|cash|cheque/.test(prompt)) {
    return [
      `${source}`,
      '🔒 I cannot change payroll data from this chat. That protects payroll logic from accidental edits.',
      'Use Wages for wage/rule edits, Employee Management for employee status, and Payroll Hours for period review/export. After you save there, ask me to explain or verify the result.',
    ].join('\n');
  }

  if (/manager|bonus/.test(prompt)) {
    const managers = rows.manager_hours;
    if (!managers.length) return `${source}\nI do not see manager rows in the current payroll context. Sync the correct period if this looks wrong.`;
    return [
      `${source}`,
      '👔 Manager hours and wages:',
      ...managers.slice(0, 18).map(lineForEmployee),
      managers.length > 18 ? `...and ${managers.length - 18} more manager rows.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/multi|multiple|two location|split/.test(prompt)) {
    const multi = rows.multi_location;
    if (!multi.length) return `${source}\nNo multi-location employees were found in the current payroll context.`;
    return [
      `${source}`,
      '📍 Multi-location employees are shown by actual worked location. Payroll Hours keeps the label and location split:',
      ...multi.slice(0, 18).map(lineForEmployee),
      multi.length > 18 ? `...and ${multi.length - 18} more multi-location rows.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/missing/.test(prompt) && /wage|salary|rate/.test(prompt)) {
    if (!context.missing_wages.length) return `${source}\nNo active employees with missing cheque wage were found in the employee table.`;
    return [
      `${source}`,
      '🧾 Employees missing cheque wage:',
      ...context.missing_wages.map(row => `- ${row.name}: ${row.location || 'No location'} · ${row.role || 'No role'}`),
    ].join('\n');
  }

  if (/wage|salary|rate/.test(prompt)) {
    const employeeMatches = context.employee_matches;
    const wageHistory = context.recent_wage_history;
    if (employeeMatches.length) {
      return [
        `${source}`,
        '💵 Matched employee wages:',
        ...employeeMatches.slice(0, 18).map(row => `- ${row.name}: cheque $${round2(row.wage)}/hr, cash $${round2(row.cash_wage || row.wage)}/hr · ${row.location || 'No location'} · ${row.role || row.department || 'No role'} · ${row.active ? 'Active' : 'Inactive'}`),
      ].join('\n');
    }
    return [
      `${source}`,
      wageHistory.length ? '📈 Recent wage history:' : 'No recent wage-history rows are available.',
      ...wageHistory.slice(0, 15).map(row => `- ${row.employee}: $${round2(row.old_wage)} → $${round2(row.new_wage)} · ${row.effective_date || String(row.detected_at || '').slice(0, 10)} · ${row.source || 'saved history'}`),
    ].join('\n');
  }

  if (/rule|cash only|cap|hold|exception/.test(prompt)) {
    const rules = context.active_rules;
    if (!rules.length) return `${source}\nNo active employee rules were found.`;
    return [
      `${source}`,
      '📌 Active payroll rules:',
      ...rules.slice(0, 22).map(rule => `- ${rule.employee}: ${rule.type}${rule.value !== null && rule.value !== undefined ? ` ${rule.value}` : ''}${rule.cash_locations ? ` · cash locations: ${rule.cash_locations}` : ''}${rule.payroll_location ? ` · payroll location: ${rule.payroll_location}` : ''}${rule.notes ? ` · ${rule.notes}` : ''}`),
      rules.length > 22 ? `...and ${rules.length - 22} more active rules.` : '',
    ].filter(Boolean).join('\n');
  }

  if (/cash|cheque|check|total|summary|pay/.test(prompt)) {
    const summary = context.payroll_summary;
    return [
      `${source}`,
      '💼 Current payroll summary:',
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
      '🔎 Matched payroll rows:',
      ...rows.matching_employees.slice(0, 18).map(lineForEmployee),
    ].join('\n');
  }

  return [
    `${source}`,
    '👋 Hi, I’m your private CM Pay AI Payroll Agent — the little payroll nerd with the laptop. I answer from CM Pay V2 only, and I do not send payroll data to Groq.',
    'Try: “show manager hours”, “check labour burden for yesterday”, “management insights for Aug 3”, “show review rows”, “wage for Steven Lin”, or “cash and cheque summary”.',
  ].filter(Boolean).join('\n');
}

async function buildCmPayContext(message: string) {
  const period = selectedRangeFromMessage(message);
  const promptTokens = tokensFromPrompt(message);
  const supabase = getSupabaseAdmin();
  const [report, rawEmployees, rawRules, rawWageHistory, rawSales] = await Promise.all([
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
    fetchAll(
      supabase,
      'daily_sales',
      'sale_date,location,gross_sales,net_sales,projected_sales,actual_labor_cost,labor_percent,sales_per_labor_hr,covers',
      query => query.gte('sale_date', period.start).lte('sale_date', period.end).order('sale_date'),
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
    management_insights: buildManagementInsights(report.rows, rawSales),
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
