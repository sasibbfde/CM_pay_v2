import 'server-only';
import { ALL_LOCATIONS_SCOPE, LOCATION_ACCOUNTS, LocationAccount } from '@/lib/location-auth';

export const LOCATION_LOGIN_OPTIONS = [
  ALL_LOCATIONS_SCOPE,
  ...LOCATION_ACCOUNTS
    .filter(account => account.role === 'location_manager')
    .map(account => account.location),
];

type PublicLocationAccount = Omit<LocationAccount, 'passwordHash'> & { builtin?: boolean };

const CM_PAY_API_BASE = (process.env.CM_PAY_API_BASE || 'https://cm-pay-v2.vercel.app').replace(/\/+$/, '');

async function requestAccountStorage(method: 'GET' | 'POST' | 'PUT', body?: unknown) {
  const secret = process.env.CM_MANAGER_BONUS_PROXY_SECRET;
  if (!secret) throw new Error('Manager Bonus proxy secret is not configured for this deployment');

  const response = await fetch(`${CM_PAY_API_BASE}/api/manager-bonus/location-accounts`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${secret}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `CM Pay account storage returned ${response.status}`);
  return payload as { ok?: boolean; accounts?: PublicLocationAccount[]; account?: PublicLocationAccount; locations?: string[] };
}

function withSessionShape(account: PublicLocationAccount): LocationAccount {
  return { ...account, passwordHash: '' };
}

export async function getLocationAccountAdminPayload() {
  const payload = await requestAccountStorage('GET');
  return {
    accounts: payload.accounts || [],
    locations: payload.locations?.length ? payload.locations : LOCATION_LOGIN_OPTIONS,
  };
}

export async function getPublicLocationAccounts() {
  return (await getLocationAccountAdminPayload()).accounts;
}

export async function findStoredLocationAccount(email: string, password: string) {
  const payload = await requestAccountStorage('POST', { email, password });
  return payload.account ? withSessionShape(payload.account) : null;
}

export async function saveLocationAccounts(input: Array<{ id?:string; location:string; email:string; password?:string; role?:'owner'|'location_manager' }>) {
  const payload = await requestAccountStorage('PUT', { accounts: input });
  return payload.accounts || [];
}
