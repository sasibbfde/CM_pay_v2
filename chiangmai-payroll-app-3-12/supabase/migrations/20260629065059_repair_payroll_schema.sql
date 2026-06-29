alter table public.employees
  add column if not exists cash_wage numeric default 0;

alter table public.punches
  add column if not exists payroll_hours numeric default 0,
  add column if not exists gross_hours numeric default 0,
  add column if not exists break_minutes numeric default 0,
  add column if not exists cash_wage numeric default 0;

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

create index if not exists punches_clocked_in_idx on public.punches (clocked_in);
create index if not exists punches_employee_id_idx on public.punches (employee_id);
create index if not exists daily_sales_sale_date_idx on public.daily_sales (sale_date);

alter table public.daily_sales enable row level security;
alter table public.sync_log enable row level security;

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
