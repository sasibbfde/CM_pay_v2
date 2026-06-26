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

async function fetchAllPages(basePath: string, limit = 100): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  let offset = 0;

  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    let url = `${basePath}${sep}limit=${limit}`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    } else {
      url += `&offset=${offset}`;
    }

    const res = await sevenFetch(url);
    const page: any[] = res?.data || (Array.isArray(res) ? res : []);
    all.push(...page);

    const nextCursor = res?.meta?.cursor ?? res?.cursor ?? null;
    if (nextCursor && nextCursor !== cursor) {
      cursor = nextCursor;
    } else if (page.length === limit) {
      cursor = null;
      offset += limit;
    } else {
      break;
    }

    if (all.length >= 5000) break;
  }
  return all;
}

/** Fetch ALL users — active AND inactive to resolve all punch names */
export async function fetchUsers() {
  // Fetch active users first, then inactive — combine both
  const [active, inactive] = await Promise.all([
    fetchAllPages(companyPath('/users?status=active'), 100),
    fetchAllPages(companyPath('/users?status=inactive'), 100),
  ]);
  // Merge, deduplicate by id (active takes priority)
  const map = new Map<string, any>();
  for (const u of inactive) map.set(String(u.id), u);
  for (const u of active)   map.set(String(u.id), u); // active overwrites
  return { data: [...map.values()] };
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
