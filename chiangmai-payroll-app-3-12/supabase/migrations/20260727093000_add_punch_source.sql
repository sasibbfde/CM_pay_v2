alter table public.punches
  add column if not exists punch_source text;

comment on column public.punches.punch_source is
  'Original 7shifts time-punch source such as pos_type=web/mobile/pos. This is separate from source, which tracks how CM Pay imported the row.';
