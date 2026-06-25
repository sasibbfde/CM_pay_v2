const BASE = 'https://api.7shifts.com/v2';

async function sevenFetch(path: string) {
  const token = process.env.SEVENSHIFTS_API_KEY;
  if (!token) throw new Error('Missing SEVENSHIFTS_API_KEY');
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`7shifts API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function companyPath(path: string) {
  const companyId = process.env.SEVENSHIFTS_COMPANY_ID;
  if (!companyId) throw new Error('Missing SEVENSHIFTS_COMPANY_ID');
  return `/company/${companyId}${path}`;
}

/** Paginate any 7shifts list endpoint until all records are fetched */
async function fetchAllPages(basePath: string, limit = 100): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const MAX = 5000; // safety cap

  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    const res  = await sevenFetch(`${basePath}${sep}limit=${limit}&offset=${offset}`);
    const page: any[] = res?.data || (Array.isArray(res) ? res : []);
    all.push(...page);
    if (page.length < limit || all.length >= MAX) break;
    offset += limit;
  }
  return all;
}

/** All ACTIVE users — fully paginated */
export async function fetchUsers() {
  const data = await fetchAllPages(companyPath('/users?status=active'), 100);
  return { data };
}

/** All locations */
export async function fetchLocations() {
  return sevenFetch(companyPath('/locations'));
}

/** All departments — for ID → name lookup */
export async function fetchDepartments() {
  const data = await fetchAllPages(companyPath('/departments'), 100);
  return { data };
}

/** All roles — for ID → name lookup */
export async function fetchRoles() {
  const data = await fetchAllPages(companyPath('/roles'), 100);
  return { data };
}

/** Time punches between two ISO timestamps — fully paginated */
export async function fetchTimePunches(start: string, end: string) {
  const base = companyPath(
    `/time_punches?clocked_in[gte]=${encodeURIComponent(start)}&clocked_in[lte]=${encodeURIComponent(end)}`
  );
  const data = await fetchAllPages(base, 200);
  return { data };
}
