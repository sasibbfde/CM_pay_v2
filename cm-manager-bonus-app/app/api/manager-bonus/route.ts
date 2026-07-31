import { NextRequest, NextResponse } from 'next/server';
import { LOCATION_AUTH_COOKIE, verifyLocationSession } from '@/lib/location-auth';

const CM_PAY_API_BASE =
  process.env.CM_PAY_API_BASE?.replace(/\/$/, '') || 'https://cm-pay-v2.vercel.app';

const proxySecret = process.env.CM_MANAGER_BONUS_PROXY_SECRET;

async function proxyManagerBonus(request: NextRequest, method: 'GET' | 'PUT') {
  const locationSession = await verifyLocationSession(request.cookies.get(LOCATION_AUTH_COOKIE)?.value);
  const locationScope = locationSession?.role === 'location_manager' ? locationSession.location : '';
  const upstreamUrl = new URL('/api/manager-bonus', CM_PAY_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
  if (method === 'GET' && locationScope) upstreamUrl.searchParams.set('location', locationScope);

  let body: string | undefined;
  if (method === 'PUT') {
    const payload = await request.json();
    if (locationScope && payload?.location !== locationScope) {
      return NextResponse.json({ error: `This login can only save ${locationScope} manager bonus records.` }, { status: 403 });
    }
    body = JSON.stringify(payload);
  }

  const upstream = await fetch(upstreamUrl, {
    method,
    headers: {
      accept: 'application/json',
      ...(proxySecret ? { authorization: `Bearer ${proxySecret}` } : {}),
      ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
    },
    body,
    cache: 'no-store',
  });

  const text = await upstream.text();
  if (method === 'GET' && locationScope && upstream.ok) {
    const data = JSON.parse(text);
    const rows = Array.isArray(data.rows) ? data.rows.filter((row: any) => row.location === locationScope) : [];
    return NextResponse.json({ ...data, rows, locationScope, sessionRole: locationSession?.role });
  }
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}

export async function GET(request: NextRequest) {
  return proxyManagerBonus(request, 'GET');
}

export async function PUT(request: NextRequest) {
  return proxyManagerBonus(request, 'PUT');
}
