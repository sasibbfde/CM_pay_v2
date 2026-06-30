alter table public.employees
  add column if not exists wage_locked boolean not null default false,
  add column if not exists wage_source text not null default '7shifts';

comment on column public.employees.wage_locked is
  'When true, roster or manually saved cheque/cash rates must not be overwritten by 7shifts sync.';

comment on column public.employees.wage_source is
  'Last authoritative source for employee wage fields, such as 7shifts, roster-2026, or manual.';
