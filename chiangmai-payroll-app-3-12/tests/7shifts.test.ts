import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailySalesAndLaborPath } from '../lib/7shifts';

test('daily sales report always includes company and optional location', () => {
  assert.equal(
    buildDailySalesAndLaborPath('123', '2026-06-22', '2026-06-28', '456'),
    '/reports/daily_sales_and_labor?company_id=123&start_date=2026-06-22&end_date=2026-06-28&location_id=456',
  );
});
