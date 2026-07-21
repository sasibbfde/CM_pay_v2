-- Security hardening: keep public Supabase tables private behind server API routes.
-- The Next.js app reads/writes these tables through SUPABASE_SERVICE_ROLE_KEY.
-- No anon/authenticated policies are created here intentionally.

alter table if exists public.sync_log enable row level security;
alter table if exists public.location_budgets enable row level security;
