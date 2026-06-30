import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBreaks, calculateGrossHours, calculatePayrollHours } from '../lib/time-punch';

test('separates paid and unpaid breaks and deducts only unpaid time', () => {
  const breaks = calculateBreaks([
    { in:'2026-06-29T16:00:00Z', out:'2026-06-29T16:30:00Z', paid:false },
    { in:'2026-06-29T18:00:00Z', out:'2026-06-29T18:15:00Z', paid:true },
  ]);
  assert.equal(breaks.breakMinutes, 45);
  assert.equal(breaks.unpaidMinutes, 30);
  assert.equal(calculatePayrollHours(8, breaks.unpaidMinutes), 7.5);
});

test('accepts alternate 7shifts break field names and calculates actual hours', () => {
  const breaks = calculateBreaks([
    { clocked_in:'2026-06-29T16:00:00Z', clocked_out:'2026-06-29T16:20:00Z', is_paid:false },
  ]);
  assert.equal(Math.round(breaks.breakMinutes), 20);
  assert.equal(calculateGrossHours('2026-06-29T12:00:00Z', '2026-06-29T20:00:00Z'), 8);
  assert.equal(calculatePayrollHours(8, breaks.unpaidMinutes), 7.67);
});
