alter table public.manager_bonus_reviews
  add column if not exists manual_hours numeric not null default 0;
