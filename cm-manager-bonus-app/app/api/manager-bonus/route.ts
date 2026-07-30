import { NextRequest, NextResponse } from 'next/server';

const CM_PAY_API_BASE =
  process.env.CM_PAY_API_BASE?.replace(/\/$/, '') || 'https://cm-pay-v2.vercel.app';

async function proxyManagerBonus(request: NextRequest, method: 'GET' | 'PUT') {
  const upstreamUrl = new URL('/api/manager-bonus', CM_PAY_API_BASE);
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  const upstream = await fetch(upstreamUrl, {
    method,
    headers: {
      accept: 'application/json',
      ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'PUT' ? await request.text() : undefined,
    cache: 'no-store',
  });

  const text = await upstream.text();
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
