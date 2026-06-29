import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

process.env.APP_USERNAME = 'test-user';
process.env.APP_PASSWORD = 'test-pass';
process.env.CRON_SECRET = 'test-cron';

test('dashboard requests require valid basic authentication', () => {
  assert.equal(proxy(new NextRequest('https://example.test/')).status, 401);

  const authorization = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;
  assert.equal(proxy(new NextRequest('https://example.test/', {
    headers: { authorization },
  })).status, 200);
});

test('cron credentials are limited to cron and sync endpoints', () => {
  const headers = { authorization: 'Bearer test-cron' };
  assert.equal(proxy(new NextRequest('https://example.test/api/payroll', { headers })).status, 401);
  assert.equal(proxy(new NextRequest('https://example.test/api/7shifts/sync', { headers })).status, 200);
  assert.equal(proxy(new NextRequest('https://example.test/api/sales-sync', { headers })).status, 200);
  assert.equal(proxy(new NextRequest('https://example.test/api/cron/daily-sync', { headers })).status, 200);
});
