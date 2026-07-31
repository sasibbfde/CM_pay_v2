import { NextRequest, NextResponse } from 'next/server';
import { LOCATION_AUTH_COOKIE, verifyLocationSession } from '@/lib/location-auth';
import { getPublicLocationAccounts, LOCATION_LOGIN_OPTIONS, saveLocationAccounts } from '@/lib/location-account-store';

async function requireOwner(request: NextRequest) {
  const session = await verifyLocationSession(request.cookies.get(LOCATION_AUTH_COOKIE)?.value);
  return session?.role === 'owner' ? session : null;
}

export async function GET(request: NextRequest) {
  const session = await requireOwner(request);
  if (!session) return NextResponse.json({ error:'Owner login is required to manage location accounts' }, { status:403 });
  return NextResponse.json({ ok:true, accounts: await getPublicLocationAccounts(), locations: LOCATION_LOGIN_OPTIONS });
}

export async function PUT(request: NextRequest) {
  const session = await requireOwner(request);
  if (!session) return NextResponse.json({ error:'Owner login is required to manage location accounts' }, { status:403 });
  try {
    const body = await request.json();
    const accounts = await saveLocationAccounts(Array.isArray(body.accounts) ? body.accounts : []);
    return NextResponse.json({ ok:true, accounts });
  } catch (error:any) {
    const message = String(error?.message || '');
    const isConfigError = message.includes('SUPABASE') || message.includes('Supabase');
    return NextResponse.json({
      error: isConfigError
        ? 'Account storage is not configured for this deployment. Please check the Manager Bonus Vercel Supabase environment variables, then try Save accounts again.'
        : message || 'Unable to save location accounts',
    }, { status:400 });
  }
}
