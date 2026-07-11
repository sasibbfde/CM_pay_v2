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
    employee_name: undefined,
    location_id:'464811',
    location:'Imm Thai Kitchen',
    role:'Server',
    wage:17.6,
    date:'2026-06-16',
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

test('matches compact 7shifts location names like YorkMills', () => {
  const lookup = hoursWagesLookup(flattenHoursAndWagesReport({
    data: [
      { user_id:'103', location_name:'Chiang Mai YorkMills', clocked_in:'2026-06-18T16:00:00Z', regular_hours:6.25, total_hours:6.25 },
    ],
  }));
  assert.equal(lookup.find({ user_id:'103', location:'Chiang Mai York Mills', clocked_in:'2026-06-18T16:00:00Z' })?.regular_hours, 6.25);
});

test('applies wrapper location to per-location hours and wages report rows', () => {
  const rows = flattenHoursAndWagesReport({
    location_id:'458858',
    location_name:'Chiang Mai York Mills',
    data: [
      { user_id:'104', clocked_in:'2026-06-19T16:00:00Z', regular_hours:4.75, total_hours:4.75 },
    ],
  });
  assert.equal(rows[0].location_id, '458858');
  assert.equal(rows[0].location, 'Chiang Mai York Mills');
});

test('matches hours and wages rows by employee name date and location when ids are missing', () => {
  const lookup = hoursWagesLookup(flattenHoursAndWagesReport({
    data: [
      { employee_name:'Tharmarasa, Thanujan', date:'2026-06-22', location_name:'Imm Thai Kitchen', regular_hours:17.99 },
    ],
  }));
  assert.equal(lookup.find({
    user_id:'999',
    employee_name:'Thanujan Tharmarasa',
    location:'Imm Thai Kitchen',
    clocked_in:'2026-06-22T10:00:00-04:00',
  })?.regular_hours, 17.99);
});
