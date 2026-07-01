-- Chiang Mai Payroll Supabase schema
-- Run this in Supabase SQL Editor once.

create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text unique,
  seven_shifts_user_id text unique,
  first_name text,
  last_name text,
  full_name text not null,
  location text,
  department text,
  role text,
  wage numeric default 0,
  cash_wage numeric default 0,
  wage_locked boolean not null default false,
  wage_source text not null default '7shifts',
  active boolean default true,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.employee_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  rule_type text not null check (rule_type in ('CASH_ONLY','PAYROLL_HOURS_CAP','COMBINED_LOCATION_CAP','SALARY_FIXED','HOLD_PAYROLL','PAY_UNDER_OTHER_LOCATION','NOTE_ONLY')),
  rule_value numeric,
  combined_locations text,
  payroll_location text,
  notes text,
  active boolean default true,
  effective_from date,
  effective_to date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.punches (
  id uuid primary key default gen_random_uuid(),
  punch_id text unique,
  employee_id text,
  seven_shifts_user_id text,
  employee_name text not null,
  location text not null,
  department text,
  role text,
  clocked_in timestamptz not null,
  clocked_out timestamptz,
  hours numeric default 0,
  payroll_hours numeric default 0,
  gross_hours numeric default 0,
  break_minutes numeric default 0,
  wage numeric default 0,
  cash_wage numeric default 0,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null,
  period text not null,
  status text default 'draft',
  summary jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text,
  record_id text,
  old_value jsonb,
  new_value jsonb,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.daily_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  location text not null,
  gross_sales numeric default 0,
  net_sales numeric default 0,
  projected_sales numeric default 0,
  actual_labor_cost numeric default 0,
  labor_percent numeric,
  sales_per_labor_hr numeric,
  covers integer default 0,
  notes text,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (sale_date, location)
);

create table if not exists public.sync_log (
  id uuid primary key default gen_random_uuid(),
  triggered_by text not null default 'manual',
  date_from date,
  date_to date,
  users_synced integer default 0,
  punches_synced integer default 0,
  duration_ms integer default 0,
  location_breakdown jsonb default '{}'::jsonb,
  notes text,
  synced_at timestamptz default now()
);

create table if not exists public.manager_bonus_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  employee_name text not null,
  location text not null,
  period_start date not null,
  period_end date not null,
  original_bonus numeric not null default 0 check (original_bonus >= 0),
  attendance smallint check (attendance between 0 and 5),
  inventory smallint check (inventory between 0 and 5),
  cleaning smallint check (cleaning between 0 and 5),
  labour_control smallint check (labour_control between 0 and 5),
  customer_service_leadership smallint check (customer_service_leadership between 0 and 5),
  notes text,
  approval text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, location, period_start, period_end),
  check (period_end >= period_start)
);

create index if not exists punches_clocked_in_idx on public.punches (clocked_in);
create index if not exists punches_employee_id_idx on public.punches (employee_id);
create index if not exists punches_employee_id_clocked_in_idx on public.punches (employee_id, clocked_in desc);
create index if not exists punches_ssid_clocked_in_idx on public.punches (seven_shifts_user_id, clocked_in desc);
create index if not exists daily_sales_sale_date_idx on public.daily_sales (sale_date);

create or replace function public.fill_employee_fields_from_punches()
returns void
language sql
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (employee_id) employee_id, location, department, role, wage
    from public.punches
    where employee_id is not null
    order by employee_id, clocked_in desc
  )
  update public.employees as e
  set location = coalesce(nullif(e.location, ''), p.location),
      department = coalesce(nullif(e.department, ''), p.department),
      role = coalesce(nullif(e.role, ''), p.role),
      wage = case when coalesce(e.wage, 0) > 0 then e.wage else p.wage end,
      updated_at = now()
  from latest as p
  where p.employee_id = e.employee_id;
$$;

revoke all on function public.fill_employee_fields_from_punches() from public, anon, authenticated;
grant execute on function public.fill_employee_fields_from_punches() to service_role;

insert into public.settings (key, value) values
('company_name', '"Chiang Mai Group"'::jsonb),
('locations', '["Imm Thai Kitchen","Chiang Mai Junction","Chiang Mai Liberty Village","Chiang Mai Mississauga","Chiang Mai York Mills","Chiang Mai Parklawn","Chiang Mai Danforth","Office"]'::jsonb),
('periods', '["1-15","16-end","month"]'::jsonb)
on conflict (key) do nothing;

-- RLS: keep tables private. The app server uses SUPABASE_SERVICE_ROLE_KEY.
alter table public.employees enable row level security;
alter table public.employee_rules enable row level security;
alter table public.punches enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.audit_log enable row level security;
alter table public.settings enable row level security;
alter table public.daily_sales enable row level security;
alter table public.sync_log enable row level security;
alter table public.manager_bonus_reviews enable row level security;

revoke all on table public.manager_bonus_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_bonus_reviews to service_role;
