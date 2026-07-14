import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSyncSafety } from '../lib/sync-safety';

const row = (hours:number, day='2026-06-16') => ({
  clocked_in: `${day}T14:00:00Z`,
  payroll_hours: hours,
  gross_hours: hours,
  break_minutes: 0,
});

test('sync safety blocks a lower 7shifts pull from overwriting payroll', () => {
  const existing = Array.from({ length: 10 }, () => row(100));
  const incoming = Array.from({ length: 9 }, () => row(90));
  const result = evaluateSyncSafety(existing, incoming, { start:'2026-06-16', end:'2026-06-30' });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /lower than existing payroll hours|fewer punch rows/);
});

test('sync safety allows a deliberate forced decrease', () => {
  const existing = Array.from({ length: 10 }, () => row(100));
  const incoming = Array.from({ length: 9 }, () => row(90));
  const result = evaluateSyncSafety(existing, incoming, { start:'2026-06-16', end:'2026-06-30', allowDecrease:true });
  assert.equal(result.ok, true);
});

test('sync safety enforces expected payable hours for exact payroll reruns', () => {
  const incoming = Array.from({ length: 10 }, () => row(90));
  const result = evaluateSyncSafety([], incoming, { start:'2026-06-16', end:'2026-06-30', expectedPayableHours:1000 });
  assert.equal(result.ok, false);
  assert.match(result.reason || '', /expected 1000.00/);
});

test('sync safety accepts expected payable hours inside tolerance', () => {
  const incoming = Array.from({ length: 10 }, () => row(100));
  const result = evaluateSyncSafety([], incoming, { start:'2026-06-16', end:'2026-06-30', expectedPayableHours:1000 });
  assert.equal(result.ok, true);
});
