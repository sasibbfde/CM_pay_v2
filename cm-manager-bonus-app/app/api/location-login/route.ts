import { NextRequest, NextResponse } from 'next/server';
import { createLocationSession, LOCATION_AUTH_COOKIE } from '@/lib/location-auth';
import { findStoredLocationAccount } from '@/lib/location-account-store';

export async function POST(request: NextRequest) {
  let account = null;
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '');
    const password = String(body.password || '');
    account = await findStoredLocationAccount(email, password);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to verify location login' }, { status: 502 });
  }
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
