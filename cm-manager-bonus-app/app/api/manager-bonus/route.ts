import { NextRequest, NextResponse } from 'next/server';
import { accountLocations, isAllowedLocation, isAllLocationsScope, LOCATION_AUTH_COOKIE, verifyLocationSession } from '@/lib/location-auth';

const CM_PAY_API_BASE =
  process.env.CM_PAY_API_BASE?.replace(/\/$/, '') || 'https://cm-pay-v2.vercel.app';

const proxySecret = process.env.CM_MANAGER_BONUS_PROXY_SECRET;

async function proxyManagerBonus(request: NextRequest, method: 'GET' | 'PUT') {
  const locationSession = await verifyLocationSession(request.cookies.get(LOCATION_AUTH_COOKIE)?.value);
  const locationScopes = locationSession?.role === 'location_manager'
    ? accountLocations({ location: locationSession.location, locations: locationSession.locations }).filter(location => !isAllLocationsScope(location))
    : [];
  const hasScopedAccess = Boolean(locationScopes.length);
  const upstreamUrl = new URL('/api/manager-bonus', CM_PAY_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
  if (method === 'GET' && locationScopes.length === 1) upstreamUrl.searchParams.set('location', locationScopes[0]);

  let body: string | undefined;
  if (method === 'PUT') {
    const payload = await request.json();
    if (hasScopedAccess && !isAllowedLocation(String(payload?.location || ''), locationScopes)) {
      return NextResponse.json({ error: `This login can only save assigned locations: ${locationScopes.join(', ')}.` }, { status: 403 });
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
  if (method === 'GET' && locationSession && upstream.ok) {
    const data = JSON.parse(text);
    const rows = Array.isArray(data.rows)
      ? hasScopedAccess ? data.rows.filter((row: any) => isAllowedLocation(row.location, locationScopes)) : data.rows
      : [];
    return NextResponse.json({ ...data, rows, locationScope: locationScopes.length === 1 ? locationScopes[0] : '', locationScopes, sessionRole: locationSession?.role });
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
