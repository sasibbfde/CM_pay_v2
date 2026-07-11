import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCashWage } from '../lib/cash-rates';

test('resolves current cash wage by employee and location from cash-rate sheet', () => {
  assert.equal(resolveCashWage({ name: 'Abishek Basnet', location: 'Chiang Mai Danforth' }), 17.6);
  assert.equal(resolveCashWage({ name: 'Thanujan Tharmarasa', location: 'Imm Thai Kitchen' }), 18.5);
  assert.equal(resolveCashWage({ name: 'Mohanasuntharam Parath Parathvasan', location: 'Chiang Mai York Mills' }), 18.5);
});

test('location-specific cash rates win for multi-location duplicate names', () => {
  assert.equal(resolveCashWage({ name: 'Pinatap (Matthew) Srisa-Ardphunwong', location: 'Chiang Mai Danforth' }), 27);
  assert.equal(resolveCashWage({ name: 'Pinatap (Matthew) Srisa-Ardphunwong', location: 'Chiang Mai Mississauga' }), 25);
});

test('stored cash wage is used only when the sheet has no safe match', () => {
  assert.equal(resolveCashWage({ name: 'Unknown Employee', location: 'Nowhere', cash_wage: 22 }), 22);
});
