import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const today     = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const yDate = fmt(yesterday);
    const tDate = fmt(today);
    const base  = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cm-pay-v2.vercel.app';

    // Run punch sync and sales sync in parallel
    const [punchRes, salesRes] = await Promise.all([
      fetch(`${base}/api/7shifts/sync`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ start:`${yDate}T00:00:00.000Z`, end:`${tDate}T23:59:59.999Z`, triggered_by:'cron-daily' }),
      }).then(r=>r.json()),
      fetch(`${base}/api/sales-sync`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ start_date: yDate, end_date: tDate }),
      }).then(r=>r.json()),
    ]);

    return NextResponse.json({ ok:true, date_range:`${yDate} to ${tDate}`, punches: punchRes, sales: salesRes });
  } catch(e: any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
