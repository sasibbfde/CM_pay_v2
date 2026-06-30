create index if not exists punches_clocked_in_idx
  on public.punches (clocked_in);

create index if not exists punches_employee_id_clocked_in_idx
  on public.punches (employee_id, clocked_in desc);

create index if not exists punches_ssid_clocked_in_idx
  on public.punches (seven_shifts_user_id, clocked_in desc);
