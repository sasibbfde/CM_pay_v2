import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHourlyWage } from '../lib/wages';

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
