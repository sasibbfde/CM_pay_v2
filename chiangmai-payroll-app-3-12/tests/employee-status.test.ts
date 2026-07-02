import assert from 'node:assert/strict';
import test from 'node:test';
import { firstPayrollPeriodEnd, isNewEmployee } from '../lib/employee-status';

test('new employees remain highlighted through their first payroll period', () => {
  assert.equal(firstPayrollPeriodEnd('2026-07-02T15:00:00Z'), '2026-07-15');
  assert.equal(firstPayrollPeriodEnd('2026-07-20T15:00:00Z'), '2026-07-31');
  assert.equal(isNewEmployee('2026-07-02T15:00:00Z', new Date('2026-07-15T16:00:00Z')), true);
  assert.equal(isNewEmployee('2026-07-02T15:00:00Z', new Date('2026-07-16T16:00:00Z')), false);
});
