import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWageChangeLabel,
  wageChangeLabelForAuditAction,
  wageChangeSourceForAuditAction,
  wageChangeSourceText,
  WAGE_CHANGE_LABEL_7SHIFTS,
  WAGE_CHANGE_LABEL_LEGACY,
  WAGE_CHANGE_LABEL_MANUAL,
} from '../lib/payroll-change-labels';

test('payroll wage change labels identify manual vs 7shifts source', () => {
  assert.equal(wageChangeSourceForAuditAction('wage_upgraded_from_7shifts'), '7shifts');
  assert.equal(wageChangeLabelForAuditAction('wage_upgraded_from_7shifts'), WAGE_CHANGE_LABEL_7SHIFTS);
  assert.equal(wageChangeSourceText('7shifts'), '7shifts wage change');

  assert.equal(wageChangeSourceForAuditAction('manual_wage_changed'), 'manual');
  assert.equal(wageChangeLabelForAuditAction('manual_wage_changed'), WAGE_CHANGE_LABEL_MANUAL);
  assert.equal(wageChangeSourceText('manual'), 'Manual wage change');

  assert.equal(wageChangeLabelForAuditAction('employee_details_updated_from_7shifts'), null);
  assert.equal(wageChangeSourceForAuditAction(null), null);
});

test('payroll wage change highlighter keeps legacy label compatibility', () => {
  assert.equal(isWageChangeLabel(WAGE_CHANGE_LABEL_7SHIFTS), true);
  assert.equal(isWageChangeLabel(WAGE_CHANGE_LABEL_MANUAL), true);
  assert.equal(isWageChangeLabel(WAGE_CHANGE_LABEL_LEGACY), true);
  assert.equal(isWageChangeLabel('POSITION CHANGED'), false);
});
