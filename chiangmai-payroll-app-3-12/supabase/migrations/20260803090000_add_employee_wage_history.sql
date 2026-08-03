-- Permanent employee wage ledger.
-- Server APIs use the service role key; no anon/authenticated policies are
-- created so wage/payroll history is not publicly readable.

create table if not exists public.employee_wage_history (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null,
  seven_shifts_user_id text,
  employee_name text not null,
  location text,
  department text,
  role text,
  role_id text not null default '__default__',
  old_wage numeric not null default 0,
  new_wage numeric not null,
  effective_date date,
  detected_at timestamptz not null default now(),
  source text not null check (source in ('7shifts_user_wages','7shifts_punch_report','manual')),
  source_period_start date,
  source_period_end date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_wage_history_unique_source_idx
  on public.employee_wage_history (employee_id, source, effective_date, role_id, new_wage);

create index if not exists employee_wage_history_employee_date_idx
  on public.employee_wage_history (employee_id, effective_date desc nulls last, detected_at desc);

create index if not exists employee_wage_history_detected_idx
  on public.employee_wage_history (detected_at desc);

alter table public.employee_wage_history enable row level security;
