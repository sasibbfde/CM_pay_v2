import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollReport, payrollLocationView, roundQuarterHour } from '../lib/payroll-report';
import { Punch } from '../lib/types';

const punch=(overrides:Partial<Punch>):Punch=>({employee_id:'7S-1',employee_name:'Test Employee',location:'Location A',department:'Back of House',role:'Wok',clocked_in:'2026-06-16T14:00:00Z',clocked_out:'2026-06-16T22:00:00Z',hours:8,payroll_hours:8,gross_hours:8,break_minutes:0,wage:20,...overrides});

test('payroll report applies the default 88h cheque cap separately per location',()=>{
  assert.equal(roundQuarterHour(73.1),73);
  assert.equal(roundQuarterHour(73.23),73.25);
  assert.equal(roundQuarterHour(73.4),73.5);
  assert.equal(roundQuarterHour(73.9),74);
  const rows=buildPayrollReport([
    punch({location:'Location A',hours:50.13,payroll_hours:50.13,gross_hours:52,break_minutes:112}),
    punch({location:'Location B',hours:43.22,payroll_hours:43.22,gross_hours:44,break_minutes:47}),
  ],[],'2026-06-30');
  assert.equal(rows[0].rounded_hours,93.5);assert.equal(rows[0].cheque_hours,93.5);assert.equal(rows[0].cash_hours,0);
  assert.deepEqual(rows[0].locations,['Location A','Location B']);
  assert.equal(rows[0].payable_hours,93.35);assert.equal(rows[0].gross_hours,96);
});

test('explicit employee hour caps still apply once across all locations',()=>{
  const [row]=buildPayrollReport([
    punch({location:'Location A',hours:50,payroll_hours:50,gross_hours:50}),
    punch({location:'Location B',hours:50,payroll_hours:50,gross_hours:50}),
  ],[{employee_name:'Test Employee',rule_type:'PAYROLL_HOURS_CAP',rule_value:88}],'2026-06-30');
  assert.equal(row.rounded_hours,100);
  assert.equal(row.cheque_hours,88);
  assert.equal(row.cash_hours,12);
  const local=payrollLocationView(row,'Location A');
  assert.equal(local.cheque_hours,44);
  assert.equal(local.cash_hours,6);
});

test('payroll report applies cash, cap, and hold rules after quarter-hour rounding',()=>{
  const punches=[punch({hours:100.2,payroll_hours:100.2,gross_hours:101,break_minutes:48})];
  assert.equal(buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'CASH_ONLY'}],'2026-06-30')[0].cash_hours,100.25);
  const capped=buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'PAYROLL_HOURS_CAP',rule_value:48}],'2026-06-30')[0];
  assert.equal(capped.cheque_hours,48);assert.equal(capped.cash_hours,52.25);
  const held=buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'HOLD_PAYROLL'}],'2026-06-30')[0];
  assert.equal(held.cheque_hours,0);assert.equal(held.cash_hours,0);assert.equal(held.total_pay,0);
});

test('payroll report exposes paid and unpaid breaks without deducting paid breaks',()=>{
  const [paid]=buildPayrollReport([punch({gross_hours:8,payroll_hours:8,hours:8,break_minutes:30})],[],'2026-06-30');
  assert.equal(paid.break_hours,.5);assert.equal(paid.unpaid_break_hours,0);assert.equal(paid.paid_break_hours,.5);assert.equal(paid.payable_hours,8);
  const [unpaid]=buildPayrollReport([punch({gross_hours:8,payroll_hours:7.5,hours:7.5,break_minutes:30})],[],'2026-06-30');
  assert.equal(unpaid.break_hours,.5);assert.equal(unpaid.unpaid_break_hours,.5);assert.equal(unpaid.paid_break_hours,0);assert.equal(unpaid.payable_hours,7.5);
});

test('location-filtered payroll shows only hours worked at that location',()=>{
  const [combined]=buildPayrollReport([
    punch({location:'Chiang Mai York Mills',hours:18.73,payroll_hours:18.73,gross_hours:20.05,break_minutes:79}),
    punch({location:'Imm Thai Kitchen',hours:17.99,payroll_hours:17.99,gross_hours:17.99,break_minutes:0}),
  ],[],'2026-06-30');
  const imm=payrollLocationView(combined,'Imm Thai Kitchen');
  assert.equal(combined.payable_hours,36.72);
  assert.equal(imm.gross_hours,17.99);
  assert.equal(imm.payable_hours,17.99);
  assert.equal(imm.rounded_hours,18);
  assert.equal(imm.cheque_hours,18);
  assert.equal(imm.cash_hours,0);
});

test('location-filtered payroll gives each worked location its own 88h cheque allocation',()=>{
  const [combined]=buildPayrollReport([
    punch({location:'Chiang Mai Junction',hours:64.28,payroll_hours:64.28,gross_hours:67.5,break_minutes:193,wage:25}),
    punch({location:'Chiang Mai Mississauga',hours:36.02,payroll_hours:36.02,gross_hours:37.75,break_minutes:104,wage:25}),
  ],[],'2026-07-15');
  const junction=payrollLocationView(combined,'Chiang Mai Junction');
  const mississauga=payrollLocationView(combined,'Chiang Mai Mississauga');
  assert.equal(junction.cheque_hours,64.25);
  assert.equal(junction.cash_hours,0);
  assert.equal(mississauga.cheque_hours,36);
  assert.equal(mississauga.cash_hours,0);
  assert.equal(combined.cheque_hours,100.25);
  assert.equal(combined.cash_hours,0);
});

test('Ontario public holiday hours are separated from regular cheque cash hours',()=>{
  const [row]=buildPayrollReport([
    punch({clocked_in:'2026-07-01T14:00:00-04:00',clocked_out:'2026-07-01T20:00:00-04:00',hours:6,payroll_hours:6,gross_hours:6,break_minutes:0,wage:20}),
    punch({clocked_in:'2026-07-02T14:00:00-04:00',clocked_out:'2026-07-02T22:00:00-04:00',hours:8,payroll_hours:8,gross_hours:8,break_minutes:0,wage:20}),
  ],[],'2026-07-15');
  assert.equal(row.payable_hours,14);
  assert.equal(row.regular_payable_hours,8);
  assert.equal(row.holiday_hours,6);
  assert.equal(row.rounded_hours,8);
  assert.equal(row.cheque_hours,8);
  assert.equal(row.cash_hours,0);
  assert.equal(row.holiday_pay,180);
  assert.equal(row.total_pay,340);
  assert.equal(row.location_holiday_hours['Location A'],6);
  assert.match(row.notes,/Canada Day/);
});

test('Ontario holiday pay consumes the 88h cheque cap and moves holiday excess to cash',()=>{
  const [row]=buildPayrollReport([
    punch({clocked_in:'2026-07-01T10:00:00-04:00',clocked_out:'2026-07-01T19:15:00-04:00',hours:9.25,payroll_hours:9.25,gross_hours:9.25,break_minutes:0,wage:20,cash_wage:20}),
    punch({clocked_in:'2026-07-02T10:00:00-04:00',clocked_out:'2026-07-02T18:00:00-04:00',hours:80,payroll_hours:80,gross_hours:80,break_minutes:0,wage:20,cash_wage:20}),
  ],[],'2026-07-15');
  assert.equal(row.regular_payable_hours,80);
  assert.equal(row.holiday_hours,9.25);
  assert.equal(row.rounded_hours,80);
  assert.equal(row.cheque_hours,80);
  assert.equal(row.cash_hours,1.25);
  assert.equal(row.cheque_pay,1600);
  assert.equal(row.cash_pay,25);
  assert.equal(row.holiday_pay,240);
  assert.equal(row.total_pay,1865);
  assert.match(row.notes,/Holiday payroll capped at 8h/);
});

test('Ontario holiday pay reduces regular cheque hours when regular hours already hit 88',()=>{
  const [row]=buildPayrollReport([
    punch({clocked_in:'2026-07-01T10:00:00-04:00',clocked_out:'2026-07-01T18:00:00-04:00',hours:8,payroll_hours:8,gross_hours:8,break_minutes:0,wage:20,cash_wage:20}),
    punch({clocked_in:'2026-07-02T10:00:00-04:00',clocked_out:'2026-07-02T18:00:00-04:00',hours:88,payroll_hours:88,gross_hours:88,break_minutes:0,wage:20,cash_wage:20}),
  ],[],'2026-07-15');
  assert.equal(row.regular_payable_hours,88);
  assert.equal(row.holiday_hours,8);
  assert.equal(row.rounded_hours,88);
  assert.equal(row.cheque_hours,80);
  assert.equal(row.cash_hours,8);
  assert.equal(row.cheque_pay,1600);
  assert.equal(row.cash_pay,160);
  assert.equal(row.holiday_pay,240);
  assert.equal(row.total_pay,2000);
});

test('location-filtered payroll applies holiday cap inside that location allocation',()=>{
  const [row]=buildPayrollReport([
    punch({location:'Chiang Mai Junction',clocked_in:'2026-07-01T10:00:00-04:00',clocked_out:'2026-07-01T19:15:00-04:00',hours:9.25,payroll_hours:9.25,gross_hours:9.25,break_minutes:0,wage:20,cash_wage:20}),
    punch({location:'Chiang Mai Junction',clocked_in:'2026-07-02T10:00:00-04:00',clocked_out:'2026-07-02T18:00:00-04:00',hours:80,payroll_hours:80,gross_hours:80,break_minutes:0,wage:20,cash_wage:20}),
  ],[],'2026-07-15');
  const local=payrollLocationView(row,'Chiang Mai Junction');
  assert.equal(local.cheque_hours,80);
  assert.equal(local.cash_hours,1.25);
  assert.equal(local.holiday_pay,240);
  assert.equal(local.total_pay,1865);
});
