import { NextResponse } from 'next/server';

export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const today = new Date();
    // Keep automatic sync inside the current payroll period only. Finalized
    // prior periods should not be rewritten by the 3am job.
    const periodStart = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() <= 15 ? 1 : 16,
    ));
    const yDate = fmt(periodStart);
    const tDate = fmt(today);
    const base = new URL(req.url).origin;
    const parseSyncResponse = async (response: Response) => {
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.errors?.join('; ') || `Sync failed with ${response.status}`);
      }
      return payload;
    };

    // Run punch sync and sales sync in parallel
    const [punchRes, salesRes] = await Promise.all([
      fetch(`${base}/api/7shifts/sync`, {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${cronSecret}`},
        body: JSON.stringify({ start:`${yDate}T00:00:00.000Z`, end:`${tDate}T23:59:59.999Z`, triggered_by:'cron-daily', sync_wages:true }),
      }).then(parseSyncResponse),
      fetch(`${base}/api/sales-sync`, {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${cronSecret}`},
        body: JSON.stringify({ start_date: yDate, end_date: tDate }),
      }).then(parseSyncResponse),
    ]);

    return NextResponse.json({ ok:true, date_range:`${yDate} to ${tDate}`, punches: punchRes, sales: salesRes });
  } catch(e: any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
