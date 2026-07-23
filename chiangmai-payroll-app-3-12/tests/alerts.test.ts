import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlerts } from '../app/api/alerts/route';

const punch = (overrides: any = {}) => ({
  punch_id: 'p-1',
  employee_id: '7S-1',
  seven_shifts_user_id: '1',
  employee_name: 'Test Employee',
  location: 'Chiang Mai Junction',
  role: 'Server',
  clocked_in: '2026-07-21T12:00:00-04:00',
  clocked_out: '2026-07-21T20:00:00-04:00',
  gross_hours: 8,
  payroll_hours: 8,
  ...overrides,
});

test('overnight alert starts at 12:05am Toronto time', () => {
  assert.equal(buildAlerts([punch({
    clocked_in: '2026-07-21T00:01:00-04:00',
    clocked_out: '2026-07-21T00:04:00-04:00',
  })]).some(alert => alert.type === 'OVERNIGHT_PUNCH'), false);

  const alerts = buildAlerts([punch({
    clocked_in: '2026-07-21T00:05:00-04:00',
    clocked_out: '2026-07-21T01:00:00-04:00',
  })]);
  assert.equal(alerts.some(alert => alert.type === 'OVERNIGHT_PUNCH'), true);
  assert.match(alerts[0].message, /12:05am–7:00am/);
});

test('overnight alert ignores shifts that only cross midnight before 12:05am', () => {
  const alerts = buildAlerts([punch({
    clocked_in: '2026-07-20T23:00:00-04:00',
    clocked_out: '2026-07-21T00:03:00-04:00',
  })]);
  assert.equal(alerts.some(alert => alert.type === 'OVERNIGHT_PUNCH'), false);
});

test('overnight alert catches long shifts that pass through 12:05am to 7:00am', () => {
  const alerts = buildAlerts([punch({
    clocked_in: '2026-07-20T23:00:00-04:00',
    clocked_out: '2026-07-21T08:00:00-04:00',
  })]);
  assert.equal(alerts.some(alert => alert.type === 'OVERNIGHT_PUNCH'), true);
});

test('daily 14h cap alert totals all punches in one Toronto date', () => {
  const alerts = buildAlerts([
    punch({
      punch_id: 'p-1',
      clocked_in: '2026-06-12T08:00:00-04:00',
      clocked_out: '2026-06-12T16:00:00-04:00',
      gross_hours: 8,
    }),
    punch({
      punch_id: 'p-2',
      clocked_in: '2026-06-12T17:00:00-04:00',
      clocked_out: '2026-06-12T23:30:00-04:00',
      gross_hours: 6.5,
    }),
  ]);

  const over14 = alerts.find(alert => alert.type === 'DAILY_OVER_14_HOURS');
  assert.equal(over14?.alert_date, '2026-06-12');
  assert.match(over14?.message || '', /14\.50 gross hours/);
});

test('daily 14h alert uses clock duration when stored gross hours are missing', () => {
  const alerts = buildAlerts([punch({
    punch_id: 'nitharsan-jul15',
    employee_id: '7S-nitharsan',
    seven_shifts_user_id: 'nitharsan',
    employee_name: 'Nitharsan Nakeenthiran',
    location: 'Chiang Mai Liberty Village',
    role: 'Packer',
    clocked_in: '2026-07-15T10:00:00-04:00',
    clocked_out: '2026-07-16T03:15:00-04:00',
    gross_hours: null,
    payroll_hours: 0,
  })]);

  const over14 = alerts.find(alert => alert.type === 'DAILY_OVER_14_HOURS');
  assert.equal(over14?.alert_date, '2026-07-15');
  assert.match(over14?.message || '', /17\.25 gross hours/);
});
