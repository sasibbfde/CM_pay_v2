import { NextResponse } from 'next/server';

export async function GET() {
  const TOKEN   = process.env.SEVENSHIFTS_API_KEY;
  const COMPANY = process.env.SEVENSHIFTS_COMPANY_ID;
  const BASE    = 'https://api.7shifts.com/v2';
  const h = { Authorization:`Bearer ${TOKEN}`, Accept:'application/json' };

  // Fetch 3 recent punches to see raw structure
  const r = await fetch(`${BASE}/company/${COMPANY}/time_punches?clocked_in[gte]=2026-06-20T00:00:00Z&clocked_in[lte]=2026-06-21T23:59:59Z&limit=3`, {headers:h, cache:'no-store'});
  const data = await r.json();

  // Show full raw punch object so we can see ALL fields
  return NextResponse.json({ status:r.status, raw_punches: data?.data?.slice(0,3) || data });
}
