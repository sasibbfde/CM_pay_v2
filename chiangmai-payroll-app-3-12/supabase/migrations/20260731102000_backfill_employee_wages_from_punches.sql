drop function if exists public.fill_employee_fields_from_punches();

create or replace function public.fill_employee_fields_from_punches()
returns table(details_filled integer, wages_filled integer, wages_upgraded integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  /*
    Keep employee master data aligned with synced 7shifts data.

    Important payroll safeguards:
    - Never downgrade an employee wage from punch/report data.
    - Use the latest non-zero punch/report wage, not simply the latest punch.
      This protects cases where the most recent raw 7punches row has $0 but
      the authoritative Hours & Wages report rows have the real wage.
    - Record wage fills/upgrades in audit_log so Wages can show the note.
  */

  with latest_details as (
    select distinct on (employee_id)
      employee_id,
      nullif(location, '') as location,
      nullif(department, '') as department,
      nullif(role, '') as role
    from public.punches
    where employee_id is not null
      and (
        nullif(location, '') is not null
        or nullif(department, '') is not null
        or nullif(role, '') is not null
      )
    order by employee_id, clocked_in desc
  ),
  changed as (
    update public.employees as e
    set location = coalesce(nullif(e.location, ''), d.location),
        department = coalesce(nullif(e.department, ''), d.department),
        role = coalesce(nullif(e.role, ''), d.role),
        updated_at = now()
    from latest_details as d
    where d.employee_id = e.employee_id
      and (
        (nullif(e.location, '') is null and d.location is not null)
        or (nullif(e.department, '') is null and d.department is not null)
        or (nullif(e.role, '') is null and d.role is not null)
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
