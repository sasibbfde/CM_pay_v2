insert into public.employees (employee_id, first_name, last_name, full_name, location, department, role, wage, active, source) values
('EMP-001','Seng','Thai','Seng Thai','Imm Thai Kitchen','Back of House','Wok',26,true,'roster'),
('EMP-002','Lachhuman','Jaisi','Lachhuman Jaisi','Chiang Mai Mississauga','Back of House','Curry',20,true,'roster'),
('EMP-003','Osmar','Marron','Osmar Marron','Chiang Mai Parklawn','Front of House','Server',17.6,true,'roster'),
('EMP-004','Komalpreet','Kaur','Komalpreet Kaur','Imm Thai Kitchen','Office','Admin',18.5,true,'roster'),
('EMP-005','Vincent','Selva','Vincent Selva','Chiang Mai Junction','Management','Manager',0,true,'roster')
on conflict (employee_id) do update set
full_name=excluded.full_name, location=excluded.location, department=excluded.department, role=excluded.role, wage=excluded.wage, active=excluded.active;

insert into public.employee_rules (employee_id, employee_name, rule_type, rule_value, combined_locations, payroll_location, notes, active) values
('EMP-001','Seng Thai','PAYROLL_HOURS_CAP',20,null,null,'ONLY 20 HOURS ON PAYROLL TOTAL. Remaining hours cash.',true),
('EMP-002','Lachhuman Jaisi','PAYROLL_HOURS_CAP',48,null,null,'48 HOURS TOTAL. Remaining hours cash.',true),
('EMP-003','Osmar Marron','PAYROLL_HOURS_CAP',48,null,null,'48 HOURS TOTAL.',true),
('EMP-004','Komalpreet Kaur','COMBINED_LOCATION_CAP',88,'Imm Thai Kitchen,Office',null,'Imm and Office combined LMIA 88 hours total.',true),
('EMP-005','Vincent Selva','SALARY_FIXED',4000,null,null,'Salary 4000. Do not change until advised.',true),
(null,'Renzo Mendoza','CASH_ONLY',null,'Chiang Mai Parklawn,Chiang Mai Mississauga',null,'Cash only. Works at Parklawn and Mississauga.',true),
(null,'Nibisha Singh','HOLD_PAYROLL',null,null,null,'Hold payroll June 16-June 31 applying for work permit.',true);

insert into public.punches (punch_id, employee_id, employee_name, location, department, role, clocked_in, clocked_out, hours, wage, source) values
('MOCK-001','EMP-001','Seng Thai','Imm Thai Kitchen','Back of House','Wok','2026-06-01T14:00:00Z','2026-06-01T23:00:00Z',9,26,'seed'),
('MOCK-002','EMP-001','Seng Thai','Imm Thai Kitchen','Back of House','Wok','2026-06-02T14:00:00Z','2026-06-02T23:00:00Z',9,26,'seed'),
('MOCK-003','EMP-001','Seng Thai','Imm Thai Kitchen','Back of House','Wok','2026-06-03T14:00:00Z','2026-06-03T23:00:00Z',9,26,'seed'),
('MOCK-004','EMP-002','Lachhuman Jaisi','Chiang Mai Mississauga','Back of House','Curry','2026-06-01T14:00:00Z','2026-06-01T23:00:00Z',42,20,'seed'),
('MOCK-005','EMP-003','Osmar Marron','Chiang Mai Parklawn','Front of House','Server','2026-06-04T16:00:00Z','2026-06-04T23:00:00Z',55,17.6,'seed'),
('MOCK-006','EMP-005','Vincent Selva','Chiang Mai Junction','Management','Manager','2026-06-01T13:00:00Z','2026-06-15T21:00:00Z',80,0,'seed')
on conflict (punch_id) do update set hours=excluded.hours, wage=excluded.wage;
