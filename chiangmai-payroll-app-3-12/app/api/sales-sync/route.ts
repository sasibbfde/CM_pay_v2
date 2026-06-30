import { NextRequest, NextResponse } from 'next/server';
import { fetchDailySalesAndLabor } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

const LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '467000': 'Chiang Mai Mississauga',
  '500371': 'Chiang Mai Mississauga',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const startDate = body.start_date || weekAgo;
    const endDate   = body.end_date   || today;

    const supabase = getSupabaseAdmin();
    const rows: any[] = [];
    const errors: string[] = [];

    // Fetch per location so we get per-location breakdown
    for (const [locId, locName] of Object.entries(LOCATION_MAP)) {
      if (locId === '500371') continue; // duplicate of Mississauga
      try {
        const data = await fetchDailySalesAndLabor(startDate, endDate, locId);
        for (const d of data?.data || []) {
          // Values come in cents from 7shifts
          const actualSales    = (d.actual_sales    || 0) / 100;
          const projSales      = (d.projected_sales || 0) / 100;
          const actualLabor    = (d.actual_labor_cost || 0) / 100;
          const laborPercent   = actualSales > 0 ? actualLabor / actualSales : null;
          const splh           = d.sales_per_labor_hour ? d.sales_per_labor_hour / 100 : null;

          if (actualSales > 0 || projSales > 0) {
            rows.push({
              sale_date:          d.date,
              location:           locName,
              gross_sales:        actualSales,
              net_sales:          actualSales,
              projected_sales:    projSales,
              actual_labor_cost:  actualLabor,
              labor_percent:      laborPercent,
              sales_per_labor_hr: splh,
              source:             '7shifts-snappy',
              updated_at:         new Date().toISOString(),
            });
          }
        }
      } catch (e: any) {
        errors.push(`${locName}: ${e.message}`);
      }
    }

    // Upsert into daily_sales
    if (rows.length > 0) {
      const { error } = await supabase
        .from('daily_sales')
        .upsert(rows, { onConflict: 'sale_date,location' });
      if (error) throw error;
    }

    const hasData = rows.length > 0;
    return NextResponse.json({
      ok: errors.length === 0 || hasData,
      synced: rows.length,
      date_range: `${startDate} to ${endDate}`,
      warnings: hasData && errors.length ? errors : undefined,
      errors: !hasData && errors.length ? errors : undefined,
    }, { status: !hasData && errors.length ? 502 : 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to   = sp.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  return POST(new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ start_date: from, end_date: to }),
    headers: { 'Content-Type': 'application/json' },
  }));
}
