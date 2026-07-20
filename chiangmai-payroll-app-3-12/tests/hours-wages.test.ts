import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenHoursAndWagesReport, hoursWagesLookup, supplementEqualPayableSplitPunches } from '../lib/hours-wages';

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

test('preserves wrapper location for 7shifts users-shaped hours and wages reports', () => {
  const rows = flattenHoursAndWagesReport({
    location_id:'500371',
    location_name:'Chiang Mai Mississauga',
    users: [{
      id:'105',
      first_name:'Mohana',
      last_name:'Sundaram',
      shifts: [{
        date:'2026-06-24',
        shift_details:'11:00AM - 8:00PM',
        role_name:'Server',
        regular_hours:8.5,
        total_hours:9,
        hourly_wage:18.5,
      }],
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, '105');
  assert.equal(rows[0].employee_name, 'Mohana Sundaram');
  assert.equal(rows[0].location_id, '500371');
  assert.equal(rows[0].location, 'Chiang Mai Mississauga');
  assert.equal(rows[0].regular_hours, 8.5);
  assert.equal(rows[0].gross_hours, 9);
  assert.equal(rows[0].break_minutes, 30);
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

test('ignores totals and break note rows from worked hours and wages reports', () => {
  const rows = flattenHoursAndWagesReport({
    location_id:'461096',
    location_name:'Chiang Mai Junction',
    data: [{
      employee_name:'Magar, Manish',
      shifts: [
        { date:'2026-06-20', shift_details:'4:00PM - 11:00PM', role_name:'Wok', regular_hours:7, total_hours:7 },
        { date:'2026-06-20', shift_details:'Unpaid Break - 15 min (8:00pm - 8:15pm)', regular_hours:0, total_hours:0 },
        { label:'Weekly Total', role_name:'Weekly Total', regular_hours:42, total_hours:42 },
        { label:'No shifts', regular_hours:0, total_hours:0 },
      ],
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].regular_hours, 7);
  assert.equal(rows[0].break_minutes, 15);
  assert.equal(rows[0].gross_hours, 7.25);
  assert.equal(rows[0].location, 'Chiang Mai Junction');
});

test('keeps same-day split shifts when both halves have identical payable hours', () => {
  const rows = flattenHoursAndWagesReport({
    location_id:'461096',
    location_name:'Chiang Mai Junction',
    data: [{
      employee_name:'Periyasamy, Gopinath',
      shifts: [
        { date:'2026-07-05', shift_details:'10:30AM - 4:00PM', role_name:'Curry', regular_hours:5.5, total_hours:5.5 },
        { date:'2026-07-05', shift_details:'4:00PM - 10:00PM', role_name:'Prep', regular_hours:5.5, total_hours:6.0 },
        { date:null, shift_details:'Unpaid Break - 30 min (7:00pm - 7:30pm)' },
      ],
    }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.shift_details), ['10:30AM - 4:00PM', '4:00PM - 10:00PM']);
  assert.deepEqual(rows.map(row => row.regular_hours), [5.5, 5.5]);
  assert.deepEqual(rows.map(row => row.gross_hours), [5.5, 6]);
  assert.deepEqual(rows.map(row => row.break_minutes || 0), [0, 30]);
});

test('supplements identical-payable split shifts collapsed by the 7shifts report API', () => {
  const reportRows = flattenHoursAndWagesReport({
    location_id:'461096',
    location_name:'Chiang Mai Junction',
    data: [{
      user: { id:'9748941' },
      employee_name:'Periyasamy, Gopinath',
      shifts: [
        { date:'2026-07-05', regular_hours:5.5, total_hours:5.5 },
      ],
    }],
  });

  const rawPunches = [
    {
      id:'raw-first-half',
      user_id:'9748941',
      location_id:'461096',
      role_id:'prep',
      clocked_in:'2026-07-05T10:30:00-04:00',
      clocked_out:'2026-07-05T16:00:00-04:00',
      breaks:[],
    },
    {
      id:'raw-second-half',
      user_id:'9748941',
      location_id:'461096',
      role_id:'prep',
      clocked_in:'2026-07-05T16:00:00-04:00',
      clocked_out:'2026-07-05T22:00:00-04:00',
      breaks:[{ in:'2026-07-05T19:00:00-04:00', out:'2026-07-05T19:30:00-04:00', paid:false }],
    },
  ];

  const result = supplementEqualPayableSplitPunches(reportRows, rawPunches, {
    startDate:'2026-07-01',
    endDate:'2026-07-15',
    normalizeLocation: locationId => locationId === '461096' ? 'Chiang Mai Junction' : 'Unknown',
    workDate: value => String(value).slice(0, 10),
    employeeNameForUser: () => 'Gopinath Periyasamy',
    roleNameForId: () => 'Prep',
  });

  assert.equal(result.supplemented, 1);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.reduce((sum, row) => sum + Number(row.regular_hours || 0), 0), 11);
  assert.deepEqual(result.supplements.map(row => row.punch_id), ['raw-second-half']);
  assert.equal(result.supplements[0].gross_hours, 6);
  assert.equal(result.supplements[0].break_minutes, 30);
});

test('does not supplement tiny raw correction fragments missing from 7shifts payroll export', () => {
  const reportRows = flattenHoursAndWagesReport({
    location_id:'500371',
    location_name:'Chiang Mai Mississauga',
    data: [{
      user: { id:'small-fragment-user' },
      employee_name:'Nukranad, Pailin',
      shifts: [
        { date:'2026-07-14', regular_hours:1.71, total_hours:1.71 },
      ],
    }],
  });

  const rawPunches = [
    {
      id:'report-represented-fragment',
      user_id:'small-fragment-user',
      location_id:'500371',
      clocked_in:'2026-07-14T12:00:00-04:00',
      clocked_out:'2026-07-14T13:42:36-04:00',
      breaks:[],
    },
    {
      id:'raw-correction-fragment',
      user_id:'small-fragment-user',
      location_id:'500371',
      clocked_in:'2026-07-14T13:42:36-04:00',
      clocked_out:'2026-07-14T15:25:12-04:00',
      breaks:[],
    },
  ];

  const result = supplementEqualPayableSplitPunches(reportRows, rawPunches, {
    startDate:'2026-07-01',
    endDate:'2026-07-15',
    normalizeLocation: locationId => locationId === '500371' ? 'Chiang Mai Mississauga' : 'Unknown',
    workDate: value => String(value).slice(0, 10),
    employeeNameForUser: () => 'Pailin Nukranad',
    roleNameForId: () => 'Expo',
  });

  assert.equal(result.supplemented, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries.reduce((sum, row) => sum + Number(row.regular_hours || 0), 0), 1.71);
});

test('matches raw punches to report rows with small payroll-hour rounding differences before supplementing', () => {
  const reportRows = flattenHoursAndWagesReport({
    location_id:'461096',
    location_name:'Chiang Mai Junction',
    data: [{
      user: { id:'rounding-user' },
      employee_name:'Example, Rounding',
      shifts: [
        { date:'2026-07-05', regular_hours:5.52, total_hours:5.52 },
        { date:'2026-07-05', regular_hours:5.52, total_hours:6.02 },
      ],
    }],
  });

  const rawPunches = [
    {
      id:'rounding-first-half',
      user_id:'rounding-user',
      location_id:'461096',
      role_id:'prep',
      clocked_in:'2026-07-05T10:30:00-04:00',
      clocked_out:'2026-07-05T16:00:00-04:00',
      breaks:[],
    },
    {
      id:'rounding-second-half',
      user_id:'rounding-user',
      location_id:'461096',
      role_id:'prep',
      clocked_in:'2026-07-05T16:00:00-04:00',
      clocked_out:'2026-07-05T22:00:00-04:00',
      breaks:[{ in:'2026-07-05T19:00:00-04:00', out:'2026-07-05T19:30:00-04:00', paid:false }],
    },
  ];

  const result = supplementEqualPayableSplitPunches(reportRows, rawPunches, {
    startDate:'2026-07-01',
    endDate:'2026-07-15',
    normalizeLocation: locationId => locationId === '461096' ? 'Chiang Mai Junction' : 'Unknown',
    workDate: value => String(value).slice(0, 10),
    employeeNameForUser: () => 'Rounding Example',
    roleNameForId: () => 'Prep',
  });

  assert.equal(result.supplemented, 0);
  assert.equal(result.entries.length, 2);
});
