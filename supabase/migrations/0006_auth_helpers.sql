-- ============================================================
-- Phase 2: auth helpers, network enforcement, employee provisioning
-- ============================================================

-- ---------- network allowlist ----------

-- Is the given IP inside any active allowlisted range?
create or replace function ip_is_allowed(p_ip inet)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from network_allowlist
    where active and p_ip <<= cidr
  )
$$;

create index if not exists network_allowlist_cidr_idx
  on network_allowlist using gist (cidr inet_ops);

-- Single authority for "may this employee enter time from this IP?"
-- Employees with can_enter_remotely bypass the check.
-- Supervisors and payroll admins are never restricted.
create or replace function may_enter_time(p_employee_id uuid, p_ip inet)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select e.can_enter_remotely
             or e.role in ('supervisor','payroll_admin')
      from employees e where e.id = p_employee_id
    ), false)
    or ip_is_allowed(p_ip)
$$;

-- ---------- assignment resolution ----------

-- The assignment in effect for an employee on a given date.
create or replace function assignment_on(p_employee_id uuid, p_date date)
returns employee_assignments language sql stable security definer set search_path = public as $$
  select *
  from employee_assignments
  where employee_id = p_employee_id
    and effective_from <= p_date
    and (effective_to is null or effective_to >= p_date)
  order by effective_from desc
  limit 1
$$;

-- Was the employee employed on this date?
create or replace function employed_on(p_employee_id uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employment_periods
    where employee_id = p_employee_id
      and hire_date <= p_date
      and (term_date is null or term_date >= p_date)
  )
$$;

-- Original hire date = earliest across all employment periods
create or replace function original_hire_date(p_employee_id uuid)
returns date language sql stable security definer set search_path = public as $$
  select min(hire_date) from employment_periods where employee_id = p_employee_id
$$;

-- Scheduled hours for an employee on a date, per their effective schedule
create or replace function scheduled_hours_on(p_employee_id uuid, p_date date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(wsd.scheduled_hours, 0)
  from assignment_on(p_employee_id, p_date) a
  join work_schedule_days wsd
    on wsd.schedule_id = a.schedule_id
   and wsd.dow = extract(dow from p_date)::int
$$;

-- ---------- convenience view ----------

create or replace view employee_current as
select
  e.id,
  e.employee_number,
  e.first_name,
  e.last_name,
  e.role,
  e.can_enter_remotely,
  e.shuttle_eligible,
  e.active,
  a.payroll_type,
  a.employee_type,
  a.holiday_eligible,
  a.schedule_id,
  ws.code  as schedule_code,
  ws.name  as schedule_name,
  a.default_work_code_id,
  wc.code  as default_work_code,
  original_hire_date(e.id) as original_hire_date,
  employed_on(e.id, current_date) as currently_employed
from employees e
left join lateral (
  select * from assignment_on(e.id, current_date)
) a on true
left join work_schedules ws on ws.id = a.schedule_id
left join work_codes wc on wc.id = a.default_work_code_id;

-- ---------- employee provisioning ----------

-- Called from a server action holding the service role key, after the
-- auth.users row is created. Links the auth user and creates the first
-- assignment + employment period atomically.
create or replace function provision_employee(
  p_auth_user_id     uuid,
  p_employee_number  text,
  p_first_name       text,
  p_last_name        text,
  p_role             app_role,
  p_payroll_type     payroll_type,
  p_employee_type    employee_type,
  p_schedule_code    text,
  p_default_work_code text,
  p_holiday_eligible boolean,
  p_can_enter_remotely boolean,
  p_shuttle_eligible boolean,
  p_hire_date        date,
  p_effective_from   date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_schedule_id uuid;
  v_work_code_id uuid;
begin
  select id into v_schedule_id from work_schedules where code = p_schedule_code;
  if v_schedule_id is null then
    raise exception 'Unknown work schedule: %', p_schedule_code;
  end if;

  if p_default_work_code is not null then
    select id into v_work_code_id from work_codes where code = p_default_work_code;
    if v_work_code_id is null then
      raise exception 'Unknown work code: %', p_default_work_code;
    end if;
  end if;

  insert into employees (auth_user_id, employee_number, first_name, last_name,
                         role, can_enter_remotely, shuttle_eligible)
  values (p_auth_user_id, p_employee_number, p_first_name, p_last_name,
          p_role, p_can_enter_remotely, p_shuttle_eligible)
  returning id into v_employee_id;

  insert into employment_periods (employee_id, hire_date)
  values (v_employee_id, p_hire_date);

  insert into employee_assignments
    (employee_id, payroll_type, employee_type, schedule_id,
     default_work_code_id, holiday_eligible, effective_from)
  values
    (v_employee_id, p_payroll_type, p_employee_type, v_schedule_id,
     v_work_code_id, p_holiday_eligible, p_effective_from);

  -- default work code is always usable
  if v_work_code_id is not null then
    insert into employee_work_codes (employee_id, work_code_id)
    values (v_employee_id, v_work_code_id)
    on conflict do nothing;
  end if;

  return v_employee_id;
end $$;

-- Change an employee's assignment: closes the current row, opens a new one.
create or replace function change_assignment(
  p_employee_id      uuid,
  p_effective_from   date,
  p_payroll_type     payroll_type,
  p_employee_type    employee_type,
  p_schedule_code    text,
  p_default_work_code text,
  p_holiday_eligible boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_schedule_id uuid;
  v_work_code_id uuid;
  v_new_id uuid;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may change assignments';
  end if;

  select id into v_schedule_id from work_schedules where code = p_schedule_code;
  if v_schedule_id is null then
    raise exception 'Unknown work schedule: %', p_schedule_code;
  end if;

  if p_default_work_code is not null then
    select id into v_work_code_id from work_codes where code = p_default_work_code;
  end if;

  -- close the currently open assignment the day before the new one starts
  update employee_assignments
     set effective_to = p_effective_from - 1
   where employee_id = p_employee_id
     and effective_to is null
     and effective_from < p_effective_from;

  insert into employee_assignments
    (employee_id, payroll_type, employee_type, schedule_id,
     default_work_code_id, holiday_eligible, effective_from)
  values
    (p_employee_id, p_payroll_type, p_employee_type, v_schedule_id,
     v_work_code_id, p_holiday_eligible, p_effective_from)
  returning id into v_new_id;

  return v_new_id;
end $$;

-- Terminate: close the open employment period and assignment.
create or replace function terminate_employee(
  p_employee_id uuid, p_term_date date, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may terminate employees';
  end if;

  update employment_periods
     set term_date = p_term_date, term_reason = p_reason
   where employee_id = p_employee_id and term_date is null;

  update employee_assignments
     set effective_to = p_term_date
   where employee_id = p_employee_id and effective_to is null;

  update employees set active = false where id = p_employee_id;
end $$;

-- Rehire: opens a new employment period and assignment (seasonal returns).
create or replace function rehire_employee(
  p_employee_id      uuid,
  p_hire_date        date,
  p_payroll_type     payroll_type,
  p_employee_type    employee_type,
  p_schedule_code    text,
  p_default_work_code text,
  p_holiday_eligible boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may rehire employees';
  end if;

  insert into employment_periods (employee_id, hire_date)
  values (p_employee_id, p_hire_date);

  update employees set active = true where id = p_employee_id;

  perform change_assignment(
    p_employee_id, p_hire_date, p_payroll_type, p_employee_type,
    p_schedule_code, p_default_work_code, p_holiday_eligible
  );
end $$;

-- view respects RLS of underlying tables
alter view employee_current set (security_invoker = true);
