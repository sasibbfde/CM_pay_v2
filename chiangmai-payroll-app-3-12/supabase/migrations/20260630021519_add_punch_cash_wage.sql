alter table public.punches
  add column if not exists cash_wage numeric default 0;

update public.punches p
set cash_wage = coalesce(e.cash_wage, 0),
    updated_at = now()
from public.employees e
where (p.employee_id = e.employee_id
       or (p.seven_shifts_user_id is not null and p.seven_shifts_user_id = e.seven_shifts_user_id))
  and coalesce(p.cash_wage, 0) <> coalesce(e.cash_wage, 0);
