const BASE = 'https://api.7shifts.com/v2';

async function sevenFetch(path: string) {
  const token = process.env.SEVENSHIFTS_API_KEY;
  if (!token) throw new Error('Missing SEVENSHIFTS_API_KEY');
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`7shifts ${res.status}: ${await res.text()}`);
  return res.json();
}

function companyPath(path: string) {
  const id = process.env.SEVENSHIFTS_COMPANY_ID;
  if (!id) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
  return `/company/${id}${path}`;
}

// 7shifts uses cursor.next for pagination — NOT the cursor object itself
async function fetchAllPages(basePath: string, limit = 100): Promise<any[]> {
  const all: any[] = [];
  let nextCursor: string | null = null;
  let offset = 0;

  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    let url = `${basePath}${sep}limit=${limit}`;
    if (nextCursor) {
      url += `&cursor=${encodeURIComponent(nextCursor)}`;
    } else {
      url += `&offset=${offset}`;
    }

    const res  = await sevenFetch(url);
    const page: any[] = res?.data || (Array.isArray(res) ? res : []);
    all.push(...page);

    // cursor is an object: { current, prev, next, count }
    const cursorObj = res?.meta?.cursor;
    const next: string | null =
      typeof cursorObj === 'object' && cursorObj !== null
        ? (cursorObj.next ?? null)
        : null;

    if (next && typeof next === 'string' && next.length > 0) {
      nextCursor = next;
    } else if (!next && page.length === limit) {
      nextCursor = null;
      offset += limit;
    } else {
      break;
    }
    if (all.length >= 10000) break;
  }
  return all;
}

/** All users (active + inactive) with their wage and role assignments */
export async function fetchUsers() {
  const [active, inactive] = await Promise.all([
    fetchAllPages(companyPath('/users?status=active'), 100),
    fetchAllPages(companyPath('/users?status=inactive'), 100),
  ]);
  const map = new Map<string, any>();
  for (const u of inactive) map.set(String(u.id), { ...u, active:false });
  for (const u of active)   map.set(String(u.id), { ...u, active:true });
  return { data: [...map.values()] };
}

/** Current wage records for one user; 7shifts exposes wages separately from users. */
export async function fetchUserWages(userId: string | number) {
  const response = await sevenFetch(companyPath(`/users/${userId}/wages`));
  const payload = response?.data || response || {};
  return { data: Array.isArray(payload.current) ? payload.current : [] };
}

export async function fetchLocations() {
  return sevenFetch(companyPath('/locations'));
}

export async function fetchDepartments() {
  const data = await fetchAllPages(companyPath('/departments'), 100);
  return { data };
}

export async function fetchRoles() {
  const data = await fetchAllPages(companyPath('/roles'), 100);
  return { data };
}

export async function fetchTimePunches(start: string, end: string) {
  const base = companyPath(
    `/time_punches?clocked_in[gte]=${encodeURIComponent(start)}&clocked_in[lte]=${encodeURIComponent(end)}`
  );
  const data = await fetchAllPages(base, 200);
  return { data };
}

/** Fetch daily sales & labor report from 7shifts (powered by Snappy POS) */
export function buildDailySalesAndLaborPath(companyId: string, startDate: string, endDate: string, locationId?: string) {
  const params = new URLSearchParams({ company_id:companyId, start_date:startDate, end_date:endDate });
  if (locationId) params.set('location_id', locationId);
  return `/reports/daily_sales_and_labor?${params.toString()}`;
}

export async function fetchDailySalesAndLabor(startDate: string, endDate: string, locationId?: string) {
  const COMPANY = process.env.SEVENSHIFTS_COMPANY_ID;
  if (!COMPANY) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
  return sevenFetch(buildDailySalesAndLaborPath(COMPANY, startDate, endDate, locationId));
}

/** Fetch scheduled shifts for a date range */
export function buildShiftsPath(companyId: string, startDate: string, endDate: string, locationId?: string) {
  const params = new URLSearchParams({
    'start[gte]': `${startDate}T00:00:00Z`,
    'start[lte]': `${endDate}T23:59:59Z`,
    sort_by: 'start',
    sort_dir: 'asc',
  });
  if (locationId) params.set('location_id', locationId);
  return `/company/${companyId}/shifts?${params.toString()}`;
}

export async function fetchShifts(startDate: string, endDate: string, locationId?: string) {
  const COMPANY = process.env.SEVENSHIFTS_COMPANY_ID;
  if (!COMPANY) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
  const data = await fetchAllPages(buildShiftsPath(COMPANY, startDate, endDate, locationId), 200);
  return { data };
}

/**
 * Fetch Hours & Wages Report from 7shifts.
 * This is the AUTHORITATIVE payroll source — returns regular_hours (break-deducted)
 * per punch, identical to the 7shifts payroll export PDF.
 * 
 * Returns per-user shift data with breaks[], total.regular_hours, total.total_hours
 */
export async function fetchHoursAndWages(startDate: string, endDate: string, locationId?: string) {
  const COMPANY = process.env.SEVENSHIFTS_COMPANY_ID;
  let path = `/reports/hours_and_wages?company_id=${COMPANY}&from=${startDate}&to=${endDate}&punches=true`;
  if (locationId) path += `&location_id=${locationId}`;
  return sevenFetch(path);
}
