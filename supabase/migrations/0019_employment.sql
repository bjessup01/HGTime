-- ============================================================
-- Phase 5h: employment lifecycle
-- ============================================================

/*
 * Assignment history with enough context for the admin screen to
 * warn before an edit does damage.
 *
 * has_timecards tells the UI whether days were computed under this
 * row - correcting it silently would change how those days scaffold.
 */
create or replace function assignment_history(p_employee_id uuid)
returns table (
  id                  uuid,
  effective_from      date,
  effective_to        date,
  payroll_type        payroll_type,
  employee_type       employee_type,
  schedule_code       text,
  default_work_code_id uuid,
  default_work_code   text,
  holiday_eligible    boolean,
  is_current          boolean,
  has_timecards       boolean,
  timecard_count      int
)
language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.effective_from,
    a.effective_to,
    a.payroll_type,
    a.employee_type,
    ws.code,
    a.default_work_code_id,
    wc.code,
    a.holiday_eligible,
    a.effective_to is null,
    coalesce(tc.n, 0) > 0,
    coalesce(tc.n, 0)::int
  from employee_assignments a
  join work_schedules ws on ws.id = a.schedule_id
  left join work_codes wc on wc.id = a.default_work_code_id
  left join lateral (
    select count(*) as n
    from timecards t
    join pay_periods pp on pp.id = t.pay_period_id
    where t.employee_id = p_employee_id
      and pp.end_date >= a.effective_from
      and (a.effective_to is null or pp.start_date <= a.effective_to)
  ) tc on true
  where a.employee_id = p_employee_id
  order by a.effective_from desc
$$;

/*
 * Correct an existing assignment row in place.
 *
 * For fixing a mistake - the row is treated as always having said
 * this. Use change_assignment instead when something genuinely
 * changed from a date, so the history keeps both.
 */
create or replace function correct_assignment(
  p_assignment_id      uuid,
  p_payroll_type       payroll_type,
  p_employee_type      employee_type,
  p_schedule_code      text,
  p_default_work_code  text,
  p_holiday_eligible   boolean,
  p_effective_from     date default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id  uuid;
  v_current      date;
  v_schedule_id  uuid;
  v_work_code_id uuid;
  v_prev         date;
  v_next         date;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may change assignments';
  end if;

  select employee_id, effective_from into v_employee_id, v_current
    from employee_assignments where id = p_assignment_id;

  if v_employee_id is null then
    raise exception 'Assignment not found';
  end if;

  select id into v_schedule_id from work_schedules where code = p_schedule_code;
  if v_schedule_id is null then
    raise exception 'Unknown work schedule: %', p_schedule_code;
  end if;

  if p_default_work_code is not null and p_default_work_code <> '' then
    select id into v_work_code_id from work_codes where code = p_default_work_code;
    if v_work_code_id is null then
      raise exception 'Unknown work code: %', p_default_work_code;
    end if;
  end if;

  -- moving the effective date must not cross its neighbours
  if p_effective_from is not null and p_effective_from <> v_current then
    select max(effective_from) into v_prev
      from employee_assignments
     where employee_id = v_employee_id
       and effective_from < v_current;

    select min(effective_from) into v_next
      from employee_assignments
     where employee_id = v_employee_id
       and effective_from > v_current;

    if v_prev is not null and p_effective_from <= v_prev then
      raise exception
        'Effective date must be after the previous assignment (%)', v_prev;
    end if;

    if v_next is not null and p_effective_from >= v_next then
      raise exception
        'Effective date must be before the next assignment (%)', v_next;
    end if;
  end if;

  update employee_assignments
     set payroll_type         = p_payroll_type,
         employee_type        = p_employee_type,
         schedule_id          = v_schedule_id,
         default_work_code_id = v_work_code_id,
         holiday_eligible     = p_holiday_eligible,
         effective_from       = coalesce(p_effective_from, effective_from)
   where id = p_assignment_id;

  -- keep the preceding row's end date adjacent to this one
  if p_effective_from is not null and p_effective_from <> v_current then
    update employee_assignments
       set effective_to = p_effective_from - 1
     where employee_id = v_employee_id
       and effective_from < p_effective_from
       and effective_to is not null
       and effective_to >= p_effective_from - 1;
  end if;
end $$;

create or replace function delete_assignment(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_count       int;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may delete assignments';
  end if;

  select employee_id into v_employee_id
    from employee_assignments where id = p_assignment_id;

  select count(*) into v_count
    from employee_assignments where employee_id = v_employee_id;

  if v_count <= 1 then
    raise exception 'An employee must keep at least one assignment';
  end if;

  delete from employee_assignments where id = p_assignment_id;

  -- if that was the open row, reopen the one before it
  if not exists (
    select 1 from employee_assignments
    where employee_id = v_employee_id and effective_to is null
  ) then
    update employee_assignments
       set effective_to = null
     where id = (
       select id from employee_assignments
       where employee_id = v_employee_id
       order by effective_from desc
       limit 1
     );
  end if;
end $$;

-- ------------------------------------------------------------
-- Termination and rehire
-- ------------------------------------------------------------

/*
 * Terminate an employee.
 *
 * Sets the end date on the open employment period and deactivates the
 * login. Open timecards are deliberately left alone - the supervisor
 * still needs to review, adjust, and approve the final card.
 *
 * A future date is allowed, for notice given in advance. The login
 * stays active until that date arrives.
 */
-- The Phase 2 version exists with parameter names (p_employee_id,
-- p_term_date, p_reason). Postgres cannot rename parameters in place,
-- so drop before redefining.
drop function if exists terminate_employee(uuid, date, text);

create or replace function terminate_employee(
  p_employee_id uuid,
  p_term_date   date,
  p_reason      text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_period_id uuid;
  v_hire      date;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may terminate employees';
  end if;

  select id, hire_date into v_period_id, v_hire
    from employment_periods
   where employee_id = p_employee_id
     and term_date is null
   order by hire_date desc
   limit 1;

  if v_period_id is null then
    raise exception 'This employee has no open employment period';
  end if;

  if p_term_date < v_hire then
    raise exception 'Last day (%) cannot be before the hire date (%)',
      p_term_date, v_hire;
  end if;

  update employment_periods
     set term_date = p_term_date,
         term_reason = coalesce(p_reason, term_reason)
   where id = v_period_id;

  -- a future termination leaves them working until the date arrives
  if p_term_date <= current_date then
    update employees set active = false where id = p_employee_id;
  end if;
end $$;

/*
 * Undo a termination - for a date entered in error, or someone who
 * withdrew their notice.
 */
create or replace function undo_termination(p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_period_id uuid;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may change employment records';
  end if;

  select id into v_period_id
    from employment_periods
   where employee_id = p_employee_id
     and term_date is not null
   order by term_date desc
   limit 1;

  if v_period_id is null then
    raise exception 'This employee has no termination to undo';
  end if;

  update employment_periods set term_date = null where id = v_period_id;
  update employees set active = true where id = p_employee_id;
end $$;

/*
 * Rehire is already defined in 0006 and creates the assignment in the
 * same call, which a rehire needs anyway. Rather than replace it, add
 * the validation it lacks: the new hire date must follow the last day
 * worked, and the employee must not already be active.
 */
create or replace function guard_rehire()
returns trigger language plpgsql set search_path = public as $$
declare
  v_last date;
  v_open int;
begin
  select count(*) into v_open
    from employment_periods
   where employee_id = new.employee_id
     and term_date is null
     and id <> new.id;

  if v_open > 0 then
    raise exception 'This employee already has an open employment period';
  end if;

  select max(term_date) into v_last
    from employment_periods
   where employee_id = new.employee_id
     and id <> new.id;

  if v_last is not null and new.hire_date <= v_last then
    raise exception 'Hire date must be after the last day worked (%)', v_last;
  end if;

  return new;
end $$;

drop trigger if exists check_rehire on employment_periods;
create trigger check_rehire
  before insert on employment_periods
  for each row execute function guard_rehire();

/*
 * Employment history for the admin screen.
 */
create or replace function employment_history(p_employee_id uuid)
returns table (
  id           uuid,
  start_date   date,
  end_date     date,
  note         text,
  is_current   boolean,
  is_future_termination boolean,
  days_worked  int
)
language sql stable security definer set search_path = public as $$
  select
    ep.id,
    ep.hire_date,
    ep.term_date,
    ep.term_reason,
    ep.term_date is null,
    ep.term_date is not null and ep.term_date > current_date,
    (coalesce(ep.term_date, current_date) - ep.hire_date)::int
  from employment_periods ep
  where ep.employee_id = p_employee_id
  order by ep.hire_date desc
$$;

/*
 * Employees whose future-dated termination has now passed, so the
 * login can be deactivated. Called on admin page load rather than by
 * a scheduled job, which keeps the moving parts down.
 */
create or replace function process_pending_terminations()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
begin
  if not is_payroll_admin() then
    return 0;
  end if;

  with due as (
    select distinct ep.employee_id
    from employment_periods ep
    join employees e on e.id = ep.employee_id
    where ep.term_date is not null
      and ep.term_date <= current_date
      and e.active
      and not exists (
        select 1 from employment_periods later
        where later.employee_id = ep.employee_id
          and later.hire_date > ep.term_date
      )
  )
  update employees e
     set active = false
    from due
   where e.id = due.employee_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
