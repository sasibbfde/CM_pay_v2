import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase';

const HASH_SALT = 'cm-manager-bonus-location-login-v1';
const SETTINGS_KEY = 'manager_bonus_location_accounts';
export const ALL_LOCATIONS_SCOPE = 'All locations';

export type ManagerBonusLocationAccount = {
  id?: string;
  email: string;
  location: string;
  locations?: string[];
  role: 'owner' | 'location_manager';
  passwordHash: string;
};

export const DEFAULT_MANAGER_BONUS_ACCOUNTS: ManagerBonusLocationAccount[] = [
  { email: 'owner.manager@cm-manager-bonus.app', location: 'All locations / Owner', role: 'owner', passwordHash: 'dfe5fd3887c8e671662d2dbce8f5a68c02022ebab3b19e4dbe29d98fdae8814c' },
  { email: 'danforth.manager@cm-manager-bonus.app', location: 'Chiang Mai Danforth', role: 'location_manager', passwordHash: '1449f6205eb1c4a05fd08483a7d4d487b8c6b2af1e316fc472b3a479edab678e' },
  { email: 'junction.manager@cm-manager-bonus.app', location: 'Chiang Mai Junction', role: 'location_manager', passwordHash: '987dcce25b6a636109095262c7eb8c2eb0d8583bb1c75e2759358190a6bf8694' },
  { email: 'liberty.manager@cm-manager-bonus.app', location: 'Chiang Mai Liberty Village', role: 'location_manager', passwordHash: '12f7db215babd863157d793b1fd7567ccd0c20f23149577914f3e8e293c9cf39' },
  { email: 'mississauga.manager@cm-manager-bonus.app', location: 'Chiang Mai Mississauga', role: 'location_manager', passwordHash: '1c3d8f016ebe33b3e43ab42e1f999f208c014aaabb7fe17e37bf96d749f3f8d5' },
  { email: 'parklawn.manager@cm-manager-bonus.app', location: 'Chiang Mai Parklawn', role: 'location_manager', passwordHash: '79582a6ea465e877597406d48a669ca5c81066a4c8d1dd116dbaf3a88a38f692' },
  { email: 'yorkmills.manager@cm-manager-bonus.app', location: 'Chiang Mai York Mills', role: 'location_manager', passwordHash: 'aad5021c8889949d536570196ddbaaea2c8c95307a506284e6d45145f24eafca' },
  { email: 'immthai.manager@cm-manager-bonus.app', location: 'Imm Thai Kitchen', role: 'location_manager', passwordHash: '63b9599ababa2d7118045c883182fc14a3d8747015ec22d7e43506f8cf906e19' },
];

export const MANAGER_BONUS_LOGIN_LOCATIONS = [
  ALL_LOCATIONS_SCOPE,
  ...DEFAULT_MANAGER_BONUS_ACCOUNTS
    .filter(account => account.role === 'location_manager')
    .map(account => account.location),
];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(buffer));
}

async function hashLocationPassword(password: string) {
  return `v2:${await sha256Hex(`${HASH_SALT}\0password-only\0${password}`)}`;
}

async function verifyLocationPassword(account: ManagerBonusLocationAccount, normalizedEmail: string, password: string) {
  const expected = account.passwordHash.startsWith('v2:')
    ? await hashLocationPassword(password)
    : await sha256Hex(`${HASH_SALT}\0${normalizedEmail}\0${password}`);
  if (expected.length !== account.passwordHash.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ account.passwordHash.charCodeAt(index);
  return diff === 0;
}

function accountId(account: Pick<ManagerBonusLocationAccount, 'email' | 'location' | 'role'>) {
  const location = account.location.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const email = account.email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return account.role === 'owner' ? 'default:owner' : `default:${location || email}`;
}

function uniqueLocations(locations: string[]) {
  const cleaned = locations.map(location => String(location || '').trim()).filter(Boolean);
  if (cleaned.some(location => location.toLowerCase() === ALL_LOCATIONS_SCOPE.toLowerCase() || location.toUpperCase() === 'ALL')) {
    return [ALL_LOCATIONS_SCOPE];
  }
  return [...new Set(cleaned)];
}

function normalizeAccountLocations(account: Pick<ManagerBonusLocationAccount, 'location'> & { locations?: string[] }) {
  return uniqueLocations(Array.isArray(account.locations) && account.locations.length ? account.locations : [account.location]);
}

function normalizeAccount(account: ManagerBonusLocationAccount): ManagerBonusLocationAccount {
  const locations = account.role === 'owner' ? [ALL_LOCATIONS_SCOPE] : normalizeAccountLocations(account);
  return {
    ...account,
    id: account.id || accountId(account),
    email: normalizeEmail(account.email),
    locations,
    location: account.role === 'owner' ? ALL_LOCATIONS_SCOPE : (locations.length === 1 ? locations[0] : locations.join(', ')),
  };
}

function publicAccount(account: ManagerBonusLocationAccount, builtinIds: Set<string>) {
  const locations = account.role === 'owner' ? [ALL_LOCATIONS_SCOPE] : normalizeAccountLocations(account);
  return {
    id: account.id || accountId(account),
    email: account.email,
    location: account.role === 'owner' ? ALL_LOCATIONS_SCOPE : (locations.length === 1 ? locations[0] : locations.join(', ')),
    locations,
    role: account.role,
    builtin: builtinIds.has(account.id || accountId(account)),
  };
}

function defaultAccountIds() {
  return new Set(DEFAULT_MANAGER_BONUS_ACCOUNTS.map(account => accountId(account)));
}

async function readStoredAccounts() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) throw error;
  const value = data?.value as { accounts?: ManagerBonusLocationAccount[] } | ManagerBonusLocationAccount[] | null | undefined;
  const accounts = Array.isArray(value) ? value : value?.accounts;
  return Array.isArray(accounts) ? accounts.filter(account => account?.location && account?.email && account?.passwordHash).map(normalizeAccount) : [];
}

async function getAccounts() {
  const stored = await readStoredAccounts();
  const defaults = DEFAULT_MANAGER_BONUS_ACCOUNTS.map(normalizeAccount);
  const byId = new Map<string, ManagerBonusLocationAccount>();
  for (const account of defaults) byId.set(account.id!, account);
  for (const account of stored) byId.set(account.id || accountId(account), account);
  return [...byId.values()];
}

export async function getPublicManagerBonusLocationAccounts() {
  const builtinIds = defaultAccountIds();
  const accounts = (await readStoredAccounts()).filter(account => !builtinIds.has(account.id || accountId(account)));
  return accounts.map(account => publicAccount(account, builtinIds));
}

export async function verifyManagerBonusLocationAccount(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const account = (await getAccounts()).find(item => normalizeEmail(item.email) === normalizedEmail);
  if (!account) return null;
  return await verifyLocationPassword(account, normalizedEmail, password)
    ? publicAccount(account, defaultAccountIds())
    : null;
}

export async function saveManagerBonusLocationAccounts(input: Array<{ id?:string; location:string; locations?:string[]; email:string; password?:string; role?:'owner'|'location_manager' }>) {
  const current = await readStoredAccounts();
  const currentById = new Map(current.map(account => [account.id || accountId(account), account]));
  const next: ManagerBonusLocationAccount[] = [];
  const seenEmails = new Set<string>();

  for (const row of input) {
    const id = String(row.id || '').trim() || `custom:${crypto.randomUUID()}`;
    const currentAccount = currentById.get(id);
    const email = normalizeEmail(String(row.email || ''));
    const role = row.role === 'owner' ? 'owner' : 'location_manager';
    const locations = role === 'owner' ? [ALL_LOCATIONS_SCOPE] : uniqueLocations(Array.isArray(row.locations) && row.locations.length ? row.locations : [row.location]);
    if (role !== 'owner' && !locations.length) throw new Error(`Choose at least one valid location for ${email || 'new login'}`);
    if (role !== 'owner') {
      const invalid = locations.find(location => !MANAGER_BONUS_LOGIN_LOCATIONS.includes(location));
      if (invalid) throw new Error(`Choose a valid location for ${invalid || 'new login'}`);
    }
    const location = role === 'owner' ? ALL_LOCATIONS_SCOPE : (locations.length === 1 ? locations[0] : locations.join(', '));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Valid email is required for ${location}`);
    if (seenEmails.has(email)) throw new Error(`Duplicate username/email is not allowed: ${email}`);
    seenEmails.add(email);
    const password = String(row.password || '').trim();
    if (!currentAccount && !password) throw new Error(`Set a password for new login ${email}`);
    if (currentAccount && email !== normalizeEmail(currentAccount.email) && currentAccount.passwordHash && !currentAccount.passwordHash.startsWith('v2:') && !password) {
      throw new Error(`Set a new password when changing the email for ${row.location || email}`);
    }
    if (password && password.length < 8) throw new Error(`Password for ${row.location || email} must be at least 8 characters`);
    next.push({
      ...(currentAccount || {}),
      id,
      email,
      location,
      locations,
      role,
      passwordHash: password ? await hashLocationPassword(password) : currentAccount!.passwordHash,
    });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('settings').upsert({
    key: SETTINGS_KEY,
    value: { accounts: next, updated_at:new Date().toISOString() },
    updated_at:new Date().toISOString(),
  });
  if (error) throw error;
  const builtinIds = defaultAccountIds();
  return next.map(account => publicAccount(account, builtinIds));
}
