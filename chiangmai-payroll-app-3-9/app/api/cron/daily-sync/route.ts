import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  // Security: Vercel sends this header for cron jobs
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Pull yesterday's punches automatically every day at 7am UTC (3am EST)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split('T')[0];

    // Also pull today (catches late-night punches)
    const today = new Date().toISOString().split('T')[0];

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://cm-pay-v2.vercel.app';

    const res = await fetch(`${baseUrl}/api/7shifts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: `${yDate}T00:00:00.000Z`,
        end:   `${today}T23:59:59.999Z`,
        triggered_by: 'cron-daily',
        notes: `Auto daily sync: ${yDate} to ${today}`,
      }),
    });

    const data = await res.json();
    return NextResponse.json({ ok: true, result: data, synced_range: `${yDate} to ${today}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
