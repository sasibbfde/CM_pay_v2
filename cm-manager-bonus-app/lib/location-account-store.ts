import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  ALL_LOCATIONS_SCOPE,
  hashLocationPassword,
  LOCATION_ACCOUNTS,
  LocationAccount,
  locationAccountId,
  verifyLocationPassword,
} from '@/lib/location-auth';

const SETTINGS_KEY = 'manager_bonus_location_accounts';

type StoredLocationAccounts = {
  accounts?: LocationAccount[];
};

export const LOCATION_LOGIN_OPTIONS = [
  ALL_LOCATIONS_SCOPE,
  ...LOCATION_ACCOUNTS
    .filter(account => account.role === 'location_manager')
    .map(account => account.location),
];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeAccount(account: LocationAccount): LocationAccount {
  return {
    ...account,
    id: account.id || locationAccountId(account),
    email: normalizeEmail(account.email),
  };
}

function sanitizeAccount(account: LocationAccount, builtinIds: Set<string>) {
  return {
    id: account.id || locationAccountId(account),
    email: account.email,
    location: account.role === 'owner' ? ALL_LOCATIONS_SCOPE : account.location,
    role: account.role,
    builtin: builtinIds.has(account.id || locationAccountId(account)),
  };
}

async function readStoredAccounts() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
    if (error) throw error;
    const value = data?.value as StoredLocationAccounts | LocationAccount[] | null | undefined;
    const accounts = Array.isArray(value) ? value : value?.accounts;
    return Array.isArray(accounts) ? accounts.filter(account => account?.location && account?.email && account?.passwordHash).map(normalizeAccount) : [];
  } catch {
    return [];
  }
}

export async function getLocationAccounts() {
  const stored = await readStoredAccounts();
  const defaults = LOCATION_ACCOUNTS.map(normalizeAccount);
  const byId = new Map<string, LocationAccount>();
  for (const account of defaults) byId.set(account.id!, account);

  for (const account of stored) {
    const normalized = normalizeAccount(account);
    const defaultMatch = defaults.find(item => item.location === normalized.location && item.role === normalized.role);
    const id = normalized.id || defaultMatch?.id || locationAccountId(normalized);
    byId.set(id, { ...normalized, id });
  }

  return [...byId.values()];
}

export async function getPublicLocationAccounts() {
  const accounts = await getLocationAccounts();
  const builtinIds = new Set(LOCATION_ACCOUNTS.map(account => locationAccountId(account)));
  return accounts.map(account => sanitizeAccount(account, builtinIds));
}

export async function findStoredLocationAccount(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const accounts = await getLocationAccounts();
  const account = accounts.find(item => normalizeEmail(item.email) === normalizedEmail);
  if (!account) return null;
  return await verifyLocationPassword(account, normalizedEmail, password) ? account : null;
}

function assertValidLocation(location: string) {
  if (!LOCATION_LOGIN_OPTIONS.includes(location)) throw new Error(`Choose a valid location for ${location || 'new login'}`);
}

export async function saveLocationAccounts(input: Array<{ id?:string; location:string; email:string; password?:string; role?:'owner'|'location_manager' }>) {
  const current = await getLocationAccounts();
  const currentById = new Map(current.map(account => [account.id || locationAccountId(account), account]));
  const defaultOwner = normalizeAccount(LOCATION_ACCOUNTS[0]);
  const next: LocationAccount[] = [];
  const seenEmails = new Set<string>();

  for (const row of input) {
    const id = String(row.id || '').trim() || `custom:${crypto.randomUUID()}`;
    const currentAccount = currentById.get(id);
    const email = normalizeEmail(String(row.email || ''));
    const role = id === defaultOwner.id ? 'owner' : row.role === 'owner' ? 'owner' : 'location_manager';
    const location = role === 'owner' ? ALL_LOCATIONS_SCOPE : String(row.location || '').trim();
    if (role !== 'owner') assertValidLocation(location);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Valid email is required for ${row.location}`);
    if (seenEmails.has(email)) throw new Error(`Duplicate username/email is not allowed: ${email}`);
    seenEmails.add(email);
    const password = String(row.password || '').trim();
    if (!currentAccount && !password) throw new Error(`Set a password for new login ${email}`);
    if (currentAccount && email !== normalizeEmail(currentAccount.email) && currentAccount.passwordHash && !currentAccount.passwordHash.startsWith('v2:') && !password) {
      throw new Error(`Set a new password when changing the email for ${row.location}`);
    }
    if (password && password.length < 8) throw new Error(`Password for ${row.location} must be at least 8 characters`);
    next.push({
      ...(currentAccount || {}),
      id,
      email,
      location,
      role,
      passwordHash: password ? await hashLocationPassword(password) : currentAccount!.passwordHash,
    });
  }

  if (!next.some(account => account.id === defaultOwner.id)) {
    next.unshift(defaultOwner);
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('settings').upsert({
    key: SETTINGS_KEY,
    value: { accounts: next, updated_at:new Date().toISOString() },
    updated_at:new Date().toISOString(),
  });
  if (error) throw error;
  const builtinIds = new Set(LOCATION_ACCOUNTS.map(account => locationAccountId(account)));
  return next.map(account => sanitizeAccount(account, builtinIds));
}
