import { NextRequest, NextResponse } from 'next/server';
import { LOCATION_AUTH_COOKIE, verifyLocationSession } from '@/lib/location-auth';

const CM_PAY_API_BASE =
  process.env.CM_PAY_API_BASE?.replace(/\/$/, '') || 'https://cm-pay-v2.vercel.app';

const proxySecret = process.env.CM_MANAGER_BONUS_PROXY_SECRET;

export async function GET(request: NextRequest) {
  const locationSession = await verifyLocationSession(request.cookies.get(LOCATION_AUTH_COOKIE)?.value);
  const locationScope = locationSession?.role === 'location_manager' ? locationSession.location : '';
  const upstreamUrl = new URL('/api/manager-bonus/export', CM_PAY_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));
  if (locationScope) upstreamUrl.searchParams.set('location', locationScope);

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
