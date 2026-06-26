import { NextResponse } from 'next/server';

export async function GET() {
  const TOKEN   = process.env.SEVENSHIFTS_API_KEY;
  const COMPANY = process.env.SEVENSHIFTS_COMPANY_ID;
  const BASE    = 'https://api.7shifts.com/v2';
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' };

  const results: any = {};

  // Test daily sales & labor report - company level
  try {
    const r = await fetch(`${BASE}/reports/daily_sales_and_labor?start_date=2026-06-20&end_date=2026-06-26&company_id=${COMPANY}`, { headers, cache:'no-store' });
    results.company_sales = { status: r.status, data: await r.json() };
  } catch(e: any) { results.company_sales_err = e.message; }

  // Test per location
  const LOCS = ['450889','458858','461096','461097','464811','465654','467000'];
  results.per_location = {};
  for (const loc of LOCS) {
    try {
      const r = await fetch(`${BASE}/reports/daily_sales_and_labor?start_date=2026-06-24&end_date=2026-06-26&location_id=${loc}`, { headers, cache:'no-store' });
      const d = await r.json();
      results.per_location[loc] = { status: r.status, data: d };
    } catch(e: any) { results.per_location[loc] = { error: (e as any).message }; }
  }

  return NextResponse.json(results);
}
