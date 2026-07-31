import { NextRequest, NextResponse } from 'next/server';
import {
  getPublicManagerBonusLocationAccounts,
  MANAGER_BONUS_LOGIN_LOCATIONS,
  saveManagerBonusLocationAccounts,
  verifyManagerBonusLocationAccount,
} from '@/lib/manager-bonus-location-accounts';

function isAuthorized(request: NextRequest) {
  const expected = process.env.CM_MANAGER_BONUS_PROXY_SECRET;
  const authorization = request.headers.get('authorization') || '';
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized manager bonus account request' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    return NextResponse.json({
      ok: true,
      accounts: await getPublicManagerBonusLocationAccounts(),
      locations: MANAGER_BONUS_LOGIN_LOCATIONS,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to load manager bonus login accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json().catch(() => ({}));
    const account = await verifyManagerBonusLocationAccount(String(body.email || ''), String(body.password || ''));
    if (!account) return NextResponse.json({ error: 'Invalid location username or password' }, { status: 401 });
    return NextResponse.json({ ok: true, account });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to verify manager bonus login' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json().catch(() => ({}));
    const accounts = await saveManagerBonusLocationAccounts(Array.isArray(body.accounts) ? body.accounts : []);
    return NextResponse.json({ ok: true, accounts, locations: MANAGER_BONUS_LOGIN_LOCATIONS });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to save manager bonus login accounts' }, { status: 400 });
  }
}
