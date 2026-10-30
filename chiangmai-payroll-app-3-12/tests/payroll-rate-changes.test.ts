import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEmployeeWages, calculatePayroll } from '../lib/payroll';
import { savedRoleForDate, type PayrollRateChange } from '../lib/payroll-rate-changes';
import type { Employee, Punch } from '../lib/types';

const employee: Employee = { employee_id:'7S-1', full_name:'Test Employee', first_name:'Test', last_name:'Employee', location:'Danforth', wage:20, cash_wage:18 };
const change: PayrollRateChange = { employee_id:'7S-1', old_wage:18, new_wage:20, effective_date:'2026-10-01', detected_at:'2026-10-30T01:00:00Z', metadata:{ old_role:'Server', new_role:'Manager' } };
const punch = (clocked_in: string, location='Danforth'): Punch => ({ employee_id:'7S-1', employee_name:'Test Employee', location, role:'Server', clocked_in, clocked_out:'2026-10-02T04:00:00Z', hours:8, payroll_hours:8, gross_hours:8.5, break_minutes:30, wage:18, cash_wage:18 });

test('7shifts roster refresh preserves an approved promotion after its effective date', () => {
  assert.equal(savedRoleForDate('Server','2026-09-30',[change]),'Server');
  assert.equal(savedRoleForDate('Server','2026-10-30',[change]),'Manager');
  assert.equal(savedRoleForDate('Wok','2026-10-30',[]),'Wok');
});

test('dated raise preserves September rates at Toronto midnight and applies October onward', () => {
  const rows = applyEmployeeWages([
    punch('2026-10-01T03:59:59Z'), punch('2026-10-01T04:00:00Z'), punch('2026-10-16T14:00:00Z'),
  ], [employee], [change]);
  assert.deepEqual(rows.map(row=>row.wage), [18,20,20]);
  assert.deepEqual(rows.map(row=>row.role), ['Server','Manager','Manager']);
  assert.deepEqual(rows.map(row=>row.cash_wage), [18,18,18]);
});

test('dated rates apply across all worked locations without matching a different employee by name', () => {
  const other = {...employee, employee_id:'7S-2', wage:19};
  const rows = applyEmployeeWages([
    punch('2026-10-02T14:00:00Z','Junction'), punch('2026-10-03T14:00:00Z','Liberty Village'),
    {...punch('2026-10-02T14:00:00Z'),employee_id:'7S-2'},
  ], [employee,other], [change]);
  assert.deepEqual(rows.map(row=>row.wage),[20,20,19]);
});

test('multiple explicitly dated changes preserve each previous saved rate', () => {
  const later = {...change, old_wage:20, new_wage:22, effective_date:'2026-11-01', detected_at:'2026-11-02T12:00:00Z'};
  const rows = applyEmployeeWages([
    punch('2026-09-15T14:00:00Z'),punch('2026-10-15T14:00:00Z'),punch('2026-11-15T14:00:00Z'),
  ], [{...employee,wage:22}], [later,change]);
  assert.deepEqual(rows.map(row=>row.wage),[18,20,22]);
});

test('employees now inactive retain approved rates on their historical worked shifts', () => {
  const rows = applyEmployeeWages([punch('2026-09-15T14:00:00Z'),punch('2026-10-15T14:00:00Z')], [], [change]);
  assert.deepEqual(rows.map(row=>row.wage),[18,20]);
});

test('rate changes leave breaks, hours, caps, and cash allocations unchanged', () => {
  const original = [punch('2026-10-02T14:00:00Z'),punch('2026-10-03T14:00:00Z')];
  const updated = applyEmployeeWages(original,[employee],[change]);
  for(let i=0;i<original.length;i++) {
    for(const field of ['clocked_in','clocked_out','hours','payroll_hours','gross_hours','break_minutes','cash_wage'] as const) assert.equal(updated[i][field],original[i][field]);
  }
  const rules = [{ employee_id:'7S-1', employee_name:'Test Employee', rule_type:'PAYROLL_HOURS_CAP' as const, rule_value:10 }];
  const [before] = calculatePayroll(original,rules);
  const [after] = calculatePayroll(updated,rules);
  assert.equal(after.actual_hours,before.actual_hours);
  assert.equal(after.payroll_hours,before.payroll_hours);
  assert.equal(after.cash_hours,before.cash_hours);
  assert.equal(after.cash_amount,before.cash_amount);
  assert.equal(before.payroll_amount,180);
  assert.equal(after.payroll_amount,200);
});
