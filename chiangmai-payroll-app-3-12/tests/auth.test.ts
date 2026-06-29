import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.CRON_SECRET = 'test-cron';
globalThis.fetch = async () => new Response(JSON.stringify({ message:'No session' }), {
  status:401,
  headers:{ 'content-type':'application/json' },
});

test('public auth pages remain accessible without a session', async () => {
  assert.equal((await proxy(new NextRequest('https://example.test/login'))).status, 200);
  assert.equal((await proxy(new NextRequest('https://example.test/signup'))).status, 200);
});

test('protected pages and APIs reject requests without a session', async () => {
  const page = await proxy(new NextRequest('https://example.test/employees?active=true'));
  assert.equal(page.status, 307);
  assert.equal(page.headers.get('location'), 'https://example.test/login?next=%2Femployees%3Factive%3Dtrue');

  const api = await proxy(new NextRequest('https://example.test/api/payroll'));
  assert.equal(api.status, 401);
});

test('cron credentials are limited to cron and sync endpoints', async () => {
  const headers = { authorization: 'Bearer test-cron' };
  assert.equal((await proxy(new NextRequest('https://example.test/api/payroll', { headers }))).status, 401);
  assert.equal((await proxy(new NextRequest('https://example.test/api/7shifts/sync', { headers }))).status, 200);
  assert.equal((await proxy(new NextRequest('https://example.test/api/sales-sync', { headers }))).status, 200);
  assert.equal((await proxy(new NextRequest('https://example.test/api/cron/daily-sync', { headers }))).status, 200);
});
