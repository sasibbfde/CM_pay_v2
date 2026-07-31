drop function if exists public.fill_employee_fields_from_punches();

create or replace function public.fill_employee_fields_from_punches()
returns table(details_filled integer, wages_filled integer, wages_upgraded integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  /*
    Fill employee master details from synced 7shifts punch/report rows.
    Treat blank, Unknown, No Role, and No Location as missing values.
  */

  with latest_location as (
    select distinct on (employee_id)
      employee_id,
      btrim(location) as location
    from public.punches
    where employee_id is not null
      and nullif(btrim(location), '') is not null
      and lower(btrim(location)) not in ('unknown', 'no location', 'null', 'undefined')
    order by employee_id, clocked_in desc
  ),
  latest_department as (
    select distinct on (employee_id)
      employee_id,
      btrim(department) as department
    from public.punches
    where employee_id is not null
      and nullif(btrim(department), '') is not null
      and lower(btrim(department)) not in ('unknown', 'no department', 'null', 'undefined')
    order by employee_id, clocked_in desc
  ),
  latest_role as (
    select distinct on (employee_id)
      employee_id,
      btrim(role) as role
    from public.punches
    where employee_id is not null
      and nullif(btrim(role), '') is not null
      and lower(btrim(role)) not in ('unknown', 'no role', 'null', 'undefined')
    order by employee_id, clocked_in desc
  ),
  latest_details as (
    select
      coalesce(l.employee_id, d.employee_id, r.employee_id) as employee_id,
      l.location,
      d.department,
      r.role
    from latest_location l
    full join latest_department d using (employee_id)
    full join latest_role r using (employee_id)
  ),
  changed as (
    update public.employees as e
    set location = case
          when (nullif(btrim(e.location), '') is null or lower(btrim(e.location)) in ('unknown', 'no location', 'null', 'undefined'))
            and d.location is not null then d.location
          else e.location
        end,
        department = case
          when (nullif(btrim(e.department), '') is null or lower(btrim(e.department)) in ('unknown', 'no department', 'null', 'undefined'))
            and d.department is not null then d.department
          else e.department
        end,
        role = case
          when (nullif(btrim(e.role), '') is null or lower(btrim(e.role)) in ('unknown', 'no role', 'null', 'undefined'))
            and d.role is not null then d.role
          else e.role
        end,
        updated_at = now()
    from latest_details as d
    where d.employee_id = e.employee_id
      and (
        ((nullif(btrim(e.location), '') is null or lower(btrim(e.location)) in ('unknown', 'no location', 'null', 'undefined')) and d.location is not null)
        or ((nullif(btrim(e.department), '') is null or lower(btrim(e.department)) in ('unknown', 'no department', 'null', 'undefined')) and d.department is not null)
        or ((nullif(btrim(e.role), '') is null or lower(btrim(e.role)) in ('unknown', 'no role', 'null', 'undefined')) and d.role is not null)
      )
    returning e.employee_id
  )
  select count(*)::integer into details_filled from changed;

  with latest_nonzero_wages as (
    select distinct on (employee_id)
      employee_id,
      employee_name,
      wage::numeric as wage,
      clocked_in
    from public.punches
    where employee_id is not null
      and coalesce(wage, 0) > 0
    order by employee_id, clocked_in desc
  ),
  candidates as (
    select
      e.employee_id,
      e.seven_shifts_user_id,
      e.full_name,
      coalesce(e.wage, 0)::numeric as old_wage,
      w.wage::numeric as new_wage
    from public.employees e
    join latest_nonzero_wages w on w.employee_id = e.employee_id
    where w.wage > 0
      and (
        coalesce(e.wage, 0) <= 0
        or w.wage > coalesce(e.wage, 0) + 0.004
      )
  ),
  audit as (
    insert into public.audit_log (
      action,
      table_name,
      record_id,
      old_value,
      new_value,
      notes,
      created_at
    )
    select
      'wage_upgraded_from_7shifts',
      'employees',
      c.employee_id,
      jsonb_build_object('wage', c.old_wage),
      jsonb_build_object(
        'wage', c.new_wage,
        'seven_shifts_user_id', c.seven_shifts_user_id,
        'employee_name', c.full_name
      ),
      case
        when c.old_wage > 0 then
          'Wage upgraded from $' || to_char(c.old_wage, 'FM999999990.00') ||
          ' to $' || to_char(c.new_wage, 'FM999999990.00') ||
          ' from 7shifts punch/report data on ' || to_char(current_date, 'YYYY-MM-DD')
        else
          'Wage saved as $' || to_char(c.new_wage, 'FM999999990.00') ||
          ' from 7shifts punch/report data on ' || to_char(current_date, 'YYYY-MM-DD')
      end,
      now()
    from candidates c
    returning record_id
  ),
  updated as (
    update public.employees as e
    set wage = c.new_wage,
        wage_source = case when c.old_wage > 0 then '7shifts-upgraded' else '7shifts' end,
        wage_locked = false,
        updated_at = now()
    from candidates c
    where c.employee_id = e.employee_id
    returning c.old_wage
  )
  select
    count(*) filter (where old_wage <= 0)::integer,
    count(*) filter (where old_wage > 0)::integer
  into wages_filled, wages_upgraded
  from updated;

  return next;
end;
$$;

revoke all on function public.fill_employee_fields_from_punches() from public, anon, authenticated;
grant execute on function public.fill_employee_fields_from_punches() to service_role;
