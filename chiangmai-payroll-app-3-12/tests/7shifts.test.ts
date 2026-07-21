import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailySalesAndLaborPath } from '../lib/7shifts';
import { normalizeShiftId, normalizeShiftTime, scheduledHours } from '../lib/schedule';

test('daily sales report always includes company and optional location', () => {
  assert.equal(
    buildDailySalesAndLaborPath('123', '2026-06-22', '2026-06-28', '456'),
    '/reports/daily_sales_and_labor?company_id=123&start_date=2026-06-22&end_date=2026-06-28&location_id=456',
  );
});

test('schedule helpers preserve unique shifts and calculate hours', () => {
  const shift = {
    user_id: 77,
    start: '2026-07-21T23:30:00-04:00',
    end: '2026-07-22T07:00:00-04:00',
    location_id: 450889,
  };
  assert.equal(normalizeShiftTime(shift,'start'), shift.start);
  assert.equal(normalizeShiftTime(shift,'end'), shift.end);
  assert.equal(scheduledHours(shift.start,shift.end), 7.5);
  assert.match(normalizeShiftId(shift,0), /77/);
});
