import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEmployeeWages, calculatePayroll, filterPunches, summarizeDailyLabour } from '../lib/payroll';
import { EmployeeRule, Punch } from '../lib/types';

function punch(overrides: Partial<Punch> = {}): Punch {
  return {
    employee_id: '7S-1', employee_name: 'Test Employee', location: 'Junction',
    clocked_in: '2026-06-01T14:00:00Z', clocked_out: '2026-06-01T19:00:00Z',
    hours: 5, wage: 20, cash_wage: 25, ...overrides,
  };
}

test('a payroll cap uses cash wage for excess hours', () => {
  const rows = calculatePayroll(
    [punch({ hours: 8 }), punch({ clocked_in:'2026-06-02T14:00:00Z', hours:8 })],
    [{ employee_name:'Test Employee', rule_type:'PAYROLL_HOURS_CAP', rule_value:10 }],
  );
  assert.equal(rows[0].payroll_hours, 10);
  assert.equal(rows[0].cash_hours, 6);
  assert.equal(rows[0].payroll_amount, 200);
  assert.equal(rows[0].cash_amount, 150);
});

test('effective dates apply a rule only to covered punches', () => {
  const rules: EmployeeRule[] = [{
    employee_name:'Test Employee', rule_type:'CASH_ONLY', effective_from:'2026-06-15',
  }];
  const rows = calculatePayroll([
    punch({ clocked_in:'2026-06-14T14:00:00Z' }),
    punch({ clocked_in:'2026-06-15T14:00:00Z' }),
  ], rules);
  assert.equal(rows[0].payroll_amount, 100);
  assert.equal(rows[0].cash_amount, 125);
  assert.equal(rows[0].rule_applied, 'STANDARD + CASH_ONLY');
});

test('period filtering uses Toronto dates at the UTC month boundary', () => {
  const lateJuneToronto = punch({ clocked_in:'2026-07-01T02:30:00Z' });
  assert.equal(filterPunches([lateJuneToronto], 2026, 6, 'month').length, 1);
  assert.equal(filterPunches([lateJuneToronto], 2026, 7, 'month').length, 0);
});

test('employees with the same name remain separate when IDs differ', () => {
  const rows = calculatePayroll([
    punch({ employee_id:'7S-1' }), punch({ employee_id:'7S-2' }),
  ], []);
  assert.equal(rows.length, 2);
});

test('current employee wages are applied to existing punches', () => {
  const [updated] = applyEmployeeWages([punch({ wage:10, cash_wage:0 })], [{
    employee_id:'7S-1', first_name:'Test', last_name:'Employee', full_name:'Test Employee',
    location:'Junction', wage:22, cash_wage:28,
  }]);
  assert.equal(updated.wage, 22);
  assert.equal(updated.cash_wage, 28);
});

test('daily labour uses Toronto dates, completed punches, and punch wages', () => {
  const rows = summarizeDailyLabour([
    punch({ clocked_in:'2026-07-01T02:30:00Z', hours:4, wage:20 }),
    punch({ clocked_in:'2026-07-01T14:00:00Z', hours:3, wage:22 }),
    punch({ clocked_in:'2026-07-01T16:00:00Z', clocked_out:'', hours:9, wage:99 }),
  ]);
  assert.deepEqual(rows.map(row => ({date:row.date,hours:row.hours,cost:row.cost})), [
    { date:'2026-06-30', hours:4, cost:80 },
    { date:'2026-07-01', hours:3, cost:66 },
  ]);
});
