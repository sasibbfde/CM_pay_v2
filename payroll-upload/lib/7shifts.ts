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

/**
 * Fetch ALL users by paginating with limit=100 until no more pages.
 * 7shifts returns at most 100 per request — this loops until done.
 */
export async function fetchUsers() {
  const allUsers: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      status: 'active',
      limit: String(limit),
      offset: String(offset),
    });

    const res = await sevenFetch(companyPath(`/users?${params}`));
    const page = res?.data || res || [];

    // Normalise: 7shifts sometimes wraps in { data: [...] } or returns array directly
    const users = Array.isArray(page) ? page : [];
    allUsers.push(...users);

    // Stop if we got fewer than a full page — no more data
    if (users.length < limit) break;

    offset += limit;

    // Safety cap — never loop more than 20 pages (2000 employees)
    if (offset >= 2000) break;
  }

  // Return in the same shape the sync route expects: { data: [...] }
  return { data: allUsers };
}

/**
 * Fetch ALL time punches in a date range, paginating 200 at a time.
 */
export async function fetchTimePunches(start: string, end: string) {
  const allPunches: any[] = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const params = new URLSearchParams({
      'clocked_in[gte]': start,
      'clocked_in[lte]': end,
      limit: String(limit),
      offset: String(offset),
    });

    const res = await sevenFetch(companyPath(`/time_punches?${params}`));
    const page = res?.data || res || [];
    const punches = Array.isArray(page) ? page : [];
    allPunches.push(...punches);

    if (punches.length < limit) break;
    offset += limit;
    if (offset >= 10000) break; // safety cap
  }

  return { data: allPunches };
}

/** All locations for the company — used to build a live ID→name map */
export async function fetchLocations() {
  return sevenFetch(companyPath('/locations'));
}
