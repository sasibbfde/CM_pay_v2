import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollReport, roundUpHalfHour } from '../lib/payroll-report';
import { Punch } from '../lib/types';

const punch=(overrides:Partial<Punch>):Punch=>({employee_id:'7S-1',employee_name:'Test Employee',location:'Location A',department:'Back of House',role:'Wok',clocked_in:'2026-06-16T14:00:00Z',clocked_out:'2026-06-16T22:00:00Z',hours:8,payroll_hours:8,gross_hours:8,break_minutes:0,wage:20,...overrides});

test('payroll report rounds combined multi-location hours up to the next half hour',()=>{
  assert.equal(roundUpHalfHour(73),73);
  assert.equal(roundUpHalfHour(73.4),73.5);
  assert.equal(roundUpHalfHour(73.9),74);
  const rows=buildPayrollReport([
    punch({location:'Location A',hours:50.13,payroll_hours:50.13,gross_hours:52,break_minutes:112}),
    punch({location:'Location B',hours:43.22,payroll_hours:43.22,gross_hours:44,break_minutes:47}),
  ],[],'2026-06-30');
  assert.equal(rows[0].rounded_hours,93.5);assert.equal(rows[0].cheque_hours,88);assert.equal(rows[0].cash_hours,5.5);
  assert.deepEqual(rows[0].locations,['Location A','Location B']);
  assert.equal(rows[0].payable_hours,93.35);assert.equal(rows[0].gross_hours,96);
});

test('payroll report applies cash, cap, and hold rules after upward half-hour rounding',()=>{
  const punches=[punch({hours:100.2,payroll_hours:100.2,gross_hours:101,break_minutes:48})];
  assert.equal(buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'CASH_ONLY'}],'2026-06-30')[0].cash_hours,100.5);
  const capped=buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'PAYROLL_HOURS_CAP',rule_value:48}],'2026-06-30')[0];
  assert.equal(capped.cheque_hours,48);assert.equal(capped.cash_hours,52.5);
  const held=buildPayrollReport(punches,[{employee_name:'Test Employee',rule_type:'HOLD_PAYROLL'}],'2026-06-30')[0];
  assert.equal(held.cheque_hours,0);assert.equal(held.cash_hours,0);assert.equal(held.total_pay,0);
});

test('payroll report exposes paid and unpaid breaks without deducting paid breaks',()=>{
  const [paid]=buildPayrollReport([punch({gross_hours:8,payroll_hours:8,hours:8,break_minutes:30})],[],'2026-06-30');
  assert.equal(paid.break_hours,.5);assert.equal(paid.unpaid_break_hours,0);assert.equal(paid.paid_break_hours,.5);assert.equal(paid.payable_hours,8);
  const [unpaid]=buildPayrollReport([punch({gross_hours:8,payroll_hours:7.5,hours:7.5,break_minutes:30})],[],'2026-06-30');
  assert.equal(unpaid.break_hours,.5);assert.equal(unpaid.unpaid_break_hours,.5);assert.equal(unpaid.paid_break_hours,0);assert.equal(unpaid.payable_hours,7.5);
});
