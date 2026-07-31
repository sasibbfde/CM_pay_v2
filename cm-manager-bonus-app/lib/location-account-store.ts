import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  hashLocationPassword,
  LOCATION_ACCOUNTS,
  LocationAccount,
  verifyLocationPassword,
} from '@/lib/location-auth';

const SETTINGS_KEY = 'manager_bonus_location_accounts';

type StoredLocationAccounts = {
  accounts?: LocationAccount[];
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sanitizeAccount(account: LocationAccount) {
  return {
    email: account.email,
    location: account.location,
    role: account.role,
  };
}

async function readStoredAccounts() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (error) throw error;
    const value = data?.value as StoredLocationAccounts | LocationAccount[] | null | undefined;
    const accounts = Array.isArray(value) ? value : value?.accounts;
    return Array.isArray(accounts) ? accounts.filter(account => account?.location && account?.email && account?.passwordHash) : [];
  } catch {
    return [];
  }
}

export async function getLocationAccounts() {
  const stored = await readStoredAccounts();
  const byLocation = new Map<string, LocationAccount>();
  for (const account of LOCATION_ACCOUNTS) byLocation.set(account.location, account);
  for (const account of stored) byLocation.set(account.location, account);
  return [...byLocation.values()];
}

export async function getPublicLocationAccounts() {
  const accounts = await getLocationAccounts();
  return accounts.map(sanitizeAccount);
}

export async function findStoredLocationAccount(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const accounts = await getLocationAccounts();
  const account = accounts.find(item => normalizeEmail(item.email) === normalizedEmail);
  if (!account) return null;
  return await verifyLocationPassword(account, normalizedEmail, password) ? account : null;
}

export async function saveLocationAccounts(input: Array<{ location:string; email:string; password?:string }>) {
  const current = await getLocationAccounts();
  const currentByLocation = new Map(current.map(account => [account.location, account]));
  const next = new Map(current.map(account => [account.location, { ...account }]));

  for (const row of input) {
    const currentAccount = currentByLocation.get(row.location);
    if (!currentAccount) throw new Error(`Unknown location account: ${row.location}`);
    const email = normalizeEmail(String(row.email || ''));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Valid email is required for ${row.location}`);
    const password = String(row.password || '');
    if (email !== normalizeEmail(currentAccount.email) && !password) {
      throw new Error(`Set a new password when changing the email for ${row.location}`);
    }
    if (password && password.length < 8) throw new Error(`Password for ${row.location} must be at least 8 characters`);
    next.set(row.location, {
      ...currentAccount,
      email,
      passwordHash: password ? await hashLocationPassword(password) : currentAccount.passwordHash,
    });
  }

  const accounts = [...next.values()];
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('settings').upsert({
    key: SETTINGS_KEY,
    value: { accounts, updated_at:new Date().toISOString() },
    updated_at:new Date().toISOString(),
  });
  if (error) throw error;
  return accounts.map(sanitizeAccount);
}
