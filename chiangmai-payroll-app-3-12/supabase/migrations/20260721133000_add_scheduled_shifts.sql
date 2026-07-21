create table if not exists public.scheduled_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_id text unique not null,
  employee_id text,
  seven_shifts_user_id text,
  employee_name text not null,
  location text not null,
  department text,
  role text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  scheduled_hours numeric not null default 0,
  status text,
  source text not null default '7shifts',
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists scheduled_shifts_start_at_idx on public.scheduled_shifts (start_at);
create index if not exists scheduled_shifts_employee_id_idx on public.scheduled_shifts (employee_id);
create index if not exists scheduled_shifts_ssid_start_at_idx on public.scheduled_shifts (seven_shifts_user_id, start_at);

alter table public.scheduled_shifts enable row level security;
revoke all on table public.scheduled_shifts from public, anon, authenticated;
grant select, insert, update, delete on table public.scheduled_shifts to service_role;
