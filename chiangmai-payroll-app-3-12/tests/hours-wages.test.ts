import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenHoursAndWagesReport, hoursWagesLookup } from '../lib/hours-wages';

test('flattens nested 7shifts hours and wages report rows', () => {
  const rows = flattenHoursAndWagesReport({
    data: [{
      user: { id:'101' },
      location: { id:'464811', name:'Imm Thai Kitchen' },
      punches: [{
        punch: { id:'p-1' },
        clocked_in:'2026-06-16T15:00:00Z',
        clocked_out:'2026-06-16T23:30:00Z',
        regular_hours:8,
        total_hours:8.5,
        role: { name:'Server' },
        wage:17.6,
      }],
    }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    punch_id:'p-1',
    user_id:'101',
    location_id:'464811',
    location:'Imm Thai Kitchen',
    role:'Server',
    wage:17.6,
    clocked_in:'2026-06-16T15:00:00Z',
    clocked_out:'2026-06-16T23:30:00Z',
    regular_hours:8,
    gross_hours:8.5,
    break_minutes:30,
  });
});

test('matches hours and wages rows by punch id or employee date location', () => {
  const lookup = hoursWagesLookup(flattenHoursAndWagesReport({
    data: [
      { punch_id:'p-1', user_id:'101', clocked_in:'2026-06-16T15:00:00Z', regular_hours:7.5, total_hours:8 },
      { user_id:'102', location:{ name:'Chiang Mai York Mills' }, clocked_in:'2026-06-17T16:00:00Z', regular_hours:5.85, total_hours:5.9 },
    ],
  }));
  assert.equal(lookup.find({ punch_id:'p-1' })?.regular_hours, 7.5);
  assert.equal(lookup.find({ user_id:'102', location:'Chiang Mai York Mills', clocked_in:'2026-06-17T16:00:00Z' })?.regular_hours, 5.85);
});
