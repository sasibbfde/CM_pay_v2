import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPayrollDate, getPunchHours } from '@/lib/payroll';
import { calculateManagerBonus, isManager, ManagerBonusScores } from '@/lib/manager-bonus';
import { fillMissingRosterDetails } from '@/lib/roster-details';

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

export async function getManagerBonusRows(periodStart: string, periodEnd: string) {
  const supabase = getSupabaseAdmin();
  const queryStart = new Date(`${periodStart}T00:00:00Z`); queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const queryEnd = new Date(`${periodEnd}T23:59:59Z`); queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);
  const [rawEmployees, punches] = await Promise.all([
    fetchAll(supabase, 'employees', 'employee_id, seven_shifts_user_id, full_name, location, department, role, active', query => query.eq('active', true)),
    fetchAll(supabase, 'punches', 'employee_id, seven_shifts_user_id, employee_name, location, department, role, clocked_in, clocked_out, hours', query => query
      .gte('clocked_in', queryStart.toISOString()).lte('clocked_in', queryEnd.toISOString()).order('clocked_in')),
  ]);
  const employees = rawEmployees.map(fillMissingRosterDetails);

  const employeeById = new Map<string, any>();
  for (const employee of employees) {
    if (employee.employee_id) employeeById.set(String(employee.employee_id), employee);
    if (employee.seven_shifts_user_id) employeeById.set(String(employee.seven_shifts_user_id), employee);
  }

  const managers = new Map<string, any>();
  for (const employee of employees) {
    if (!isManager(employee.department, employee.role)) continue;
    const employeeId = String(employee.employee_id || employee.seven_shifts_user_id || employee.full_name);
    const location = employee.location || 'Unknown';
    managers.set(`${employeeId}\u0000${location}`, { employee_id:employeeId, employee_name:employee.full_name, location, department:employee.department || '', role:employee.role || '', worked_hours:0 });
  }

  for (const punch of punches) {
    const date = getPayrollDate(punch.clocked_in);
    if (!date || date < periodStart || date > periodEnd) continue;
    const employee = employeeById.get(String(punch.employee_id || punch.seven_shifts_user_id || ''));
    if (!isManager(employee?.department || punch.department, employee?.role || punch.role)) continue;
    const employeeId = String(employee?.employee_id || punch.employee_id || employee?.seven_shifts_user_id || punch.seven_shifts_user_id || punch.employee_name);
    const location = punch.location || employee?.location || 'Unknown';
    const key = `${employeeId}\u0000${location}`;
    const row = managers.get(key) || { employee_id:employeeId, employee_name:employee?.full_name || punch.employee_name, location, department:employee?.department || punch.department || '', role:employee?.role || punch.role || '', worked_hours:0 };
    row.worked_hours += getPunchHours({ ...punch, wage:0 });
    managers.set(key, row);
  }
  const employeesWithHours = new Set([...managers.values()].filter(row => row.worked_hours > 0).map(row => row.employee_id));
  for (const [key, row] of managers) {
    if (row.worked_hours === 0 && employeesWithHours.has(row.employee_id)) managers.delete(key);
  }

  let reviews: any[] = [];
  let tableReady = true;
  const settingRows = await fetchAll(supabase, 'settings', 'key,value', query => query.like('key', 'manager_bonus:%'));
  const fallbackReviews = settingRows.map(row => row.value).filter(value => value?.period_start === periodStart && value?.period_end === periodEnd);
  try {
    reviews = await fetchAll(supabase, 'manager_bonus_reviews', '*', query => query.eq('period_start', periodStart).eq('period_end', periodEnd));
  } catch (error: any) {
    if (error?.code === 'PGRST205' || /manager_bonus_reviews/i.test(error?.message || '')) tableReady = false;
    else throw error;
  }
  const reviewByKey = new Map([...fallbackReviews, ...reviews].map(review => [`${review.employee_id}\u0000${review.location}`, review]));

  const rows = [...managers.values()].map(manager => {
    const review = reviewByKey.get(`${manager.employee_id}\u0000${manager.location}`) || {};
    const scores: ManagerBonusScores = {
      attendance: review.attendance ?? null,
      inventory: review.inventory ?? null,
      cleaning: review.cleaning ?? null,
      labour_control: review.labour_control ?? null,
      customer_service_leadership: review.customer_service_leadership ?? null,
    };
    const seven_shifts_hours = Math.round(manager.worked_hours * 100) / 100;
    const manual_hours = Number(review.manual_hours || 0);
    return { ...manager, ...review, ...scores, seven_shifts_hours, manual_hours, worked_hours:Math.round((seven_shifts_hours + manual_hours) * 100) / 100, original_bonus:Number(review.original_bonus || 0), ...calculateManagerBonus(Number(review.original_bonus || 0), scores) };
  }).sort((a,b) => a.location.localeCompare(b.location) || a.employee_name.localeCompare(b.employee_name));

  return { rows, tableReady, storageMode:tableReady?'manager_bonus_reviews':'settings_fallback' };
}
