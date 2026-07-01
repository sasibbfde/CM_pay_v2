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

create index if not exists manager_bonus_reviews_period_idx
  on public.manager_bonus_reviews (period_start, period_end, location);

alter table public.manager_bonus_reviews enable row level security;
revoke all on table public.manager_bonus_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.manager_bonus_reviews to service_role;
