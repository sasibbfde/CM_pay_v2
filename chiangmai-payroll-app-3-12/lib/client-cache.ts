'use client';

type CacheEntry = { expires:number; data:unknown };
const memory = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();
const STORAGE_PREFIX = 'cm-pay-cache:';

function readEntry(key: string): CacheEntry | undefined {
  const inMemory = memory.get(key);
  if (inMemory && inMemory.expires > Date.now()) return inMemory;
  if (inMemory) memory.delete(key);
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as CacheEntry;
    if (stored.expires <= Date.now()) {
      sessionStorage.removeItem(STORAGE_PREFIX + key);
      return undefined;
    }
    memory.set(key, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function peekJson<T>(url: string): T | undefined {
  return readEntry(url)?.data as T | undefined;
}

export async function cachedJson<T>(url: string, maxAgeMs = 120_000, force = false): Promise<T> {
  if (!force) {
    const cached = peekJson<T>(url);
    if (cached !== undefined) return cached;
    const existing = pending.get(url);
    if (existing) return existing as Promise<T>;
  }

  const request = fetch(url).then(async response => {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      throw new Error('Session expired');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    const entry: CacheEntry = { expires:Date.now() + maxAgeMs, data };
    memory.set(url, entry);
    if (typeof window !== 'undefined') {
      try { sessionStorage.setItem(STORAGE_PREFIX + url, JSON.stringify(entry)); } catch { /* cache is optional */ }
    }
    return data as T;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

export function invalidateClientCache(prefixes: string[] = ['/api/']) {
  for (const key of [...memory.keys()]) {
    if (prefixes.some(prefix => key.startsWith(prefix))) memory.delete(key);
  }
  if (typeof window === 'undefined') return;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const storageKey = sessionStorage.key(index);
    if (!storageKey?.startsWith(STORAGE_PREFIX)) continue;
    const key = storageKey.slice(STORAGE_PREFIX.length);
    if (prefixes.some(prefix => key.startsWith(prefix))) sessionStorage.removeItem(storageKey);
  }
}
