export const LOCATION_AUTH_COOKIE = 'cm_manager_bonus_location_session';
const HASH_SALT = 'cm-manager-bonus-location-login-v1';

export type LocationAccount = {
  id?: string;
  email: string;
  location: string;
  locations?: string[];
  role: 'owner' | 'location_manager';
  passwordHash: string;
};

export const ALL_LOCATIONS_SCOPE = 'All locations';

export const LOCATION_ACCOUNTS: LocationAccount[] = [
  { email: 'owner.manager@cm-manager-bonus.app', location: 'All locations / Owner', role: 'owner', passwordHash: 'dfe5fd3887c8e671662d2dbce8f5a68c02022ebab3b19e4dbe29d98fdae8814c' },
  { email: 'danforth.manager@cm-manager-bonus.app', location: 'Chiang Mai Danforth', role: 'location_manager', passwordHash: '1449f6205eb1c4a05fd08483a7d4d487b8c6b2af1e316fc472b3a479edab678e' },
  { email: 'junction.manager@cm-manager-bonus.app', location: 'Chiang Mai Junction', role: 'location_manager', passwordHash: '987dcce25b6a636109095262c7eb8c2eb0d8583bb1c75e2759358190a6bf8694' },
  { email: 'liberty.manager@cm-manager-bonus.app', location: 'Chiang Mai Liberty Village', role: 'location_manager', passwordHash: '12f7db215babd863157d793b1fd7567ccd0c20f23149577914f3e8e293c9cf39' },
  { email: 'mississauga.manager@cm-manager-bonus.app', location: 'Chiang Mai Mississauga', role: 'location_manager', passwordHash: '1c3d8f016ebe33b3e43ab42e1f999f208c014aaabb7fe17e37bf96d749f3f8d5' },
  { email: 'parklawn.manager@cm-manager-bonus.app', location: 'Chiang Mai Parklawn', role: 'location_manager', passwordHash: '79582a6ea465e877597406d48a669ca5c81066a4c8d1dd116dbaf3a88a38f692' },
  { email: 'yorkmills.manager@cm-manager-bonus.app', location: 'Chiang Mai York Mills', role: 'location_manager', passwordHash: 'aad5021c8889949d536570196ddbaaea2c8c95307a506284e6d45145f24eafca' },
  { email: 'immthai.manager@cm-manager-bonus.app', location: 'Imm Thai Kitchen', role: 'location_manager', passwordHash: '63b9599ababa2d7118045c883182fc14a3d8747015ec22d7e43506f8cf906e19' },
];

export function locationAccountId(account: Pick<LocationAccount, 'email' | 'location' | 'role'>) {
  const location = account.location.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const email = account.email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return account.role === 'owner' ? 'default:owner' : `default:${location || email}`;
}

export function isAllLocationsScope(location?: string | null) {
  return String(location || '').trim().toLowerCase() === ALL_LOCATIONS_SCOPE.toLowerCase()
    || String(location || '').trim().toUpperCase() === 'ALL';
}

export function accountLocations(account: Pick<LocationAccount, 'location'> & { locations?: string[] }) {
  const locations = Array.isArray(account.locations) && account.locations.length ? account.locations : [account.location];
  const cleaned = locations.map(location => String(location || '').trim()).filter(Boolean);
  if (cleaned.some(isAllLocationsScope)) return [ALL_LOCATIONS_SCOPE];
  return [...new Set(cleaned)];
}

export function isAllowedLocation(location: string, allowedLocations: string[]) {
  return allowedLocations.some(isAllLocationsScope) || allowedLocations.includes(location);
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(buffer));
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export async function findLocationAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const account = LOCATION_ACCOUNTS.find(item => item.email === normalizedEmail);
  if (!account) return null;
  return await verifyLocationPassword(account, normalizedEmail, password) ? account : null;
}

export async function hashLocationPassword(password: string) {
  return `v2:${await sha256Hex(`${HASH_SALT}\0password-only\0${password}`)}`;
}

export async function verifyLocationPassword(account: LocationAccount, normalizedEmail: string, password: string) {
  if (account.passwordHash.startsWith('v2:')) {
    const hash = await hashLocationPassword(password);
    return timingSafeEqual(hash, account.passwordHash);
  }
  const legacyHash = await sha256Hex(`${HASH_SALT}\0${normalizedEmail}\0${password}`);
  return timingSafeEqual(legacyHash, account.passwordHash);
}

export function locationAuthSecret() {
  return process.env.CM_MANAGER_BONUS_PROXY_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || 'cm-manager-bonus-dev-secret';
}

export async function createLocationSession(account: LocationAccount) {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;
  const locations = account.role === 'owner' ? [ALL_LOCATIONS_SCOPE] : accountLocations(account);
  const payload = base64UrlEncode(JSON.stringify({
    email: account.email,
    location: locations.length === 1 ? locations[0] : locations.join(', '),
    locations,
    role: account.role,
    exp: expiresAt,
  }));
  const signature = await hmacHex(locationAuthSecret(), payload);
  return `${payload}.${signature}`;
}

export async function verifyLocationSession(token?: string | null) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await hmacHex(locationAuthSecret(), payload);
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session?.email || Number(session.exp || 0) < Date.now()) return null;
    return {
      ...session,
      locations: Array.isArray(session.locations) && session.locations.length ? session.locations : [session.location],
    } as { email:string; location:string; locations:string[]; role:'owner'|'location_manager'; exp:number };
  } catch {
    return null;
  }
}
