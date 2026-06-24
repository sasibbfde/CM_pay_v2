import {Employee,EmployeeRule,Punch} from './types';
export const mockEmployees:Employee[]=[
{first_name:'Seng',last_name:'Thai',full_name:'Seng Thai',location:'Imm Thai Kitchen',department:'Back of House',role:'Wok',wage:26,active:true,source:'roster'},
{first_name:'Lachhuman',last_name:'Jaisi',full_name:'Lachhuman Jaisi',location:'Chiang Mai SQ1',department:'Back of House',role:'Curry',wage:20,active:true,source:'roster'},
{first_name:'Osmar',last_name:'Marron',full_name:'Osmar Marron',location:'Chiang Mai Parklawn',department:'Front of House',role:'Server',wage:17.6,active:true,source:'roster'},
{first_name:'Komalpreet',last_name:'Kaur',full_name:'Komalpreet Kaur',location:'Imm Thai Kitchen',department:'Office',role:'Admin',wage:18.5,active:true,source:'roster'},
{first_name:'Vincent',last_name:'Selva',full_name:'Vincent Selva',location:'Chiang Mai Junction',department:'Management',role:'Manager',wage:0,active:true,source:'roster'}];
export const mockRules:EmployeeRule[]=[
{employee_name:'Seng Thai',rule_type:'PAYROLL_HOURS_CAP',rule_value:20,notes:'ONLY 20 HOURS ON PAYROLL TOTAL',active:true},
{employee_name:'Lachhuman Jaisi',rule_type:'PAYROLL_HOURS_CAP',rule_value:48,notes:'48 HOURS TOTAL - remaining cash hours',active:true},
{employee_name:'Osmar Marron',rule_type:'PAYROLL_HOURS_CAP',rule_value:48,notes:'48 HOURS TOTAL',active:true},
{employee_name:'Komalpreet Kaur',rule_type:'COMBINED_LOCATION_CAP',rule_value:88,combined_locations:'Imm Thai Kitchen,Office',notes:'Imm thai and office combined LMIA 88 hours total',active:true},
{employee_name:'Vincent Selva',rule_type:'SALARY_FIXED',rule_value:4000,notes:'Salary 4000 - do not change until advise',active:true},
{employee_name:'Renzo Mendoza',rule_type:'CASH_ONLY',notes:'CASH works at Parklawn and SQ1',active:true},
{employee_name:'Nibisha Singh',rule_type:'HOLD_PAYROLL',notes:'Hold payroll June 16-June 31 applying for work permit',active:true}
];
export const mockPunches:Punch[]=[
{employee_name:'Seng Thai',location:'Imm Thai Kitchen',department:'Back of House',role:'Wok',clocked_in:'2026-06-01T14:00:00Z',clocked_out:'2026-06-01T23:00:00Z',hours:9,wage:26,source:'mock'},
{employee_name:'Seng Thai',location:'Imm Thai Kitchen',department:'Back of House',role:'Wok',clocked_in:'2026-06-02T14:00:00Z',clocked_out:'2026-06-02T23:00:00Z',hours:9,wage:26,source:'mock'},
{employee_name:'Seng Thai',location:'Imm Thai Kitchen',department:'Back of House',role:'Wok',clocked_in:'2026-06-03T14:00:00Z',clocked_out:'2026-06-03T23:00:00Z',hours:9,wage:26,source:'mock'},
{employee_name:'Lachhuman Jaisi',location:'Chiang Mai SQ1',department:'Back of House',role:'Curry',clocked_in:'2026-06-01T14:00:00Z',clocked_out:'2026-06-01T23:00:00Z',hours:42,wage:20,source:'mock'},
{employee_name:'Osmar Marron',location:'Chiang Mai Parklawn',department:'Front of House',role:'Server',clocked_in:'2026-06-04T16:00:00Z',clocked_out:'2026-06-04T23:00:00Z',hours:55,wage:17.6,source:'mock'},
{employee_name:'Vincent Selva',location:'Chiang Mai Junction',department:'Management',role:'Manager',clocked_in:'2026-06-01T13:00:00Z',clocked_out:'2026-06-15T21:00:00Z',hours:80,wage:0,source:'mock'}];
