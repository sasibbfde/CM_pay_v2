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
  wage numeric default 0,
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
