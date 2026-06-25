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

/** All users/employees in the company */
export async function fetchUsers() {
  return sevenFetch(companyPath('/users?status=active'));
}

/** All locations for the company — used to build a live ID→name map */
export async function fetchLocations() {
  return sevenFetch(companyPath('/locations'));
}

/** Time punches between two ISO timestamps */
export async function fetchTimePunches(start: string, end: string) {
  const params = new URLSearchParams({
    'clocked_in[gte]': start,
    'clocked_in[lte]': end,
  });
  return sevenFetch(companyPath(`/time_punches?${params}`));
}
