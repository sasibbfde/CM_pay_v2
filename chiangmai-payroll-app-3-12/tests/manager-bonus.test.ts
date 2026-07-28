import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateManagerBonus, calculateTemplateManagerBonus, isManager, normalizeRating, rubricForManager } from '../lib/manager-bonus';

test('manager bonus prorates the 50 percent pool over 25 points', () => {
  const result = calculateManagerBonus(1000, {
    attendance: 3, inventory: 3, cleaning: 3, labour_control: 3, customer_service_leadership: 3,
  });
  assert.equal(result.totalPoints, 15);
  assert.equal(result.scorePercent, 0.6);
  assert.equal(result.earnedExtraBonus, 300);
  assert.equal(result.finalBonus, 1300);
});

test('manager matching uses department or role', () => {
  assert.equal(isManager('Management', 'Server'), true);
  assert.equal(isManager('Front of House', 'General Manager'), true);
  assert.equal(isManager('Back of House', 'Cook'), false);
});

test('manager bonus template prorates 10 ratings over configurable points and pool', () => {
  const result = calculateTemplateManagerBonus(1000, [4,4,3,5,2,5,4,3,3,2], 50, 50);
  assert.equal(result.totalPoints, 35);
  assert.equal(result.scorePercent, 0.7);
  assert.equal(result.maxExtraBonus, 500);
  assert.equal(result.earnedExtraBonus, 350);
  assert.equal(result.finalBonus, 1350);
});

test('manager bonus rubric switches between front and kitchen content', () => {
  assert.equal(rubricForManager('Front of House', 'Manager')[1].label, 'Floor Leadership');
  assert.equal(rubricForManager('Back of House', 'Kitchen Manager')[1].label, 'Kitchen Leadership & Line Management');
});

test('ratings accept only whole numbers from zero to five', () => {
  assert.equal(normalizeRating('5'), 5);
  assert.equal(normalizeRating(''), null);
  assert.throws(() => normalizeRating(6));
  assert.throws(() => normalizeRating(2.5));
});
