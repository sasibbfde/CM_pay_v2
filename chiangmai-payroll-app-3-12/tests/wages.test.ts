import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEmployeeWage, selectHourlyWage, shouldUpgradeEmployeeWage, wageUpgradeNote } from '../lib/wages';

test('selects the latest effective role-specific 7shifts wage', () => {
  const wages = [
    { effective_date:'2026-01-01', role_id:10, wage_type:'hourly', wage_cents:1800 },
    { effective_date:'2026-06-01', role_id:10, wage_type:'hourly', wage_cents:2150 },
    { effective_date:'2026-05-01', role_id:null, wage_type:'hourly', wage_cents:1950 },
  ];
  assert.equal(selectHourlyWage(wages, 10, '2026-06-29'), 21.5);
  assert.equal(selectHourlyWage(wages, 99, '2026-06-29'), 19.5);
  assert.equal(selectHourlyWage(wages, 10, '2026-05-15'), 18);
});

test('does not treat a weekly salary as an hourly wage', () => {
  assert.equal(selectHourlyWage([
    { effective_date:'2026-01-01', role_id:null, wage_type:'weekly_salary', wage_cents:140000 },
  ], null, '2026-06-29'), 0);
});

test('saved wages are never downgraded by 7shifts', () => {
  assert.equal(resolveEmployeeWage({ wage: 23.5, wage_locked: true }, 18), 23.5);
  assert.equal(resolveEmployeeWage({ wage: 20, wage_locked: false }, 18), 20);
  assert.equal(resolveEmployeeWage({ wage: 20, wage_locked: false }, 0), 20);
});

test('higher 7shifts wages upgrade the app wage', () => {
  assert.equal(resolveEmployeeWage({ wage: 20, wage_locked: true }, 22.5), 22.5);
  assert.equal(shouldUpgradeEmployeeWage({ wage: 20, wage_locked: true }, 22.5), true);
  assert.equal(shouldUpgradeEmployeeWage({ wage: 23, wage_locked: false }, 22.5), false);
  assert.equal(wageUpgradeNote(20, 22.5, new Date('2026-07-16T12:00:00Z')), 'Wage upgraded from $20.00 to $22.50 from 7shifts on 2026-07-16');
});
