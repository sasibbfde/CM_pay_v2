export type Employee={employee_id?:string;first_name:string;last_name:string;full_name:string;location:string;department?:string;role?:string;wage:number;active?:boolean;source?:string};
export type RuleType='CASH_ONLY'|'PAYROLL_HOURS_CAP'|'COMBINED_LOCATION_CAP'|'SALARY_FIXED'|'HOLD_PAYROLL'|'PAY_UNDER_OTHER_LOCATION'|'NOTE_ONLY';
export type EmployeeRule={employee_name:string;rule_type:RuleType;rule_value?:number|string;combined_locations?:string;payroll_location?:string;notes?:string;active?:boolean;effective_from?:string;effective_to?:string};
export type Punch={punch_id?:string;employee_id?:string;employee_name:string;location:string;department?:string;role?:string;clocked_in:string;clocked_out:string;hours:number;wage:number;source?:string};
export type PayrollRow={employee_name:string;location:string;department?:string;role?:string;actual_hours:number;payroll_hours:number;cash_hours:number;wage:number;payroll_amount:number;cash_amount:number;rule_applied:string;notes?:string};
