import { NextRequest, NextResponse } from 'next/server';
import { createLocationSession, findLocationAccount, LOCATION_AUTH_COOKIE } from '@/lib/location-auth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');
  const password = String(body.password || '');
  const account = await findLocationAccount(email, password);
  if (!account) return NextResponse.json({ error: 'Invalid location username or password' }, { status: 401 });

  const response = NextResponse.json({ ok: true, email: account.email, location: account.location, role: account.role });
  response.cookies.set(LOCATION_AUTH_COOKIE, await createLocationSession(account), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCATION_AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
