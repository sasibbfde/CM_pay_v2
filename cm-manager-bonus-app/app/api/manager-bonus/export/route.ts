import { NextRequest, NextResponse } from 'next/server';
import { accountLocations, isAllowedLocation, isAllLocationsScope, LOCATION_AUTH_COOKIE, verifyLocationSession } from '@/lib/location-auth';

const CM_PAY_API_BASE =
  process.env.CM_PAY_API_BASE?.replace(/\/$/, '') || 'https://cm-pay-v2.vercel.app';

const proxySecret = process.env.CM_MANAGER_BONUS_PROXY_SECRET;

export async function GET(request: NextRequest) {
  const locationSession = await verifyLocationSession(request.cookies.get(LOCATION_AUTH_COOKIE)?.value);
  const locationScopes = locationSession?.role === 'location_manager'
    ? accountLocations({ location: locationSession.location, locations: locationSession.locations }).filter(location => !isAllLocationsScope(location))
    : [];
  const requestedLocation = request.nextUrl.searchParams.get('location') || '';
  if (locationScopes.length > 1 && (!requestedLocation || requestedLocation === 'ALL')) {
    return NextResponse.json({ error: `Choose one assigned location before exporting: ${locationScopes.join(', ')}` }, { status: 400 });
  }
  if (locationScopes.length && requestedLocation && requestedLocation !== 'ALL' && !isAllowedLocation(requestedLocation, locationScopes)) {
    return NextResponse.json({ error: `This login can only export assigned locations: ${locationScopes.join(', ')}` }, { status: 403 });
  }
  const upstreamUrl = new URL('/api/manager-bonus/export', CM_PAY_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
  if (locationScopes.length === 1) upstreamUrl.searchParams.set('location', locationScopes[0]);

  const upstream = await fetch(upstreamUrl, {
    headers: {
      accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(proxySecret ? { authorization: `Bearer ${proxySecret}` } : {}),
    },
    cache: 'no-store',
  });

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') || 'attachment; filename="Manager_Bonus.xlsx"',
    },
  });
}
