-- ============================================================
-- Bootstrap: create the first payroll admin
--
-- Chicken-and-egg: creating employees requires an admin, but there
-- is no admin yet. Run this ONCE in the Supabase SQL Editor (which
-- bypasses RLS) after creating an auth user in the dashboard.
--
-- STEPS
--   1. Supabase dashboard -> Authentication -> Users -> Add user
--        Email:    <your employee number>@timekeeping.local
--                  (e.g. 1001@timekeeping.local)
--        Password: a 6-digit PIN you choose
--        Check "Auto Confirm User"
--   2. Copy the new user's UUID
--   3. Fill in the values below and run
-- ============================================================

do $$
declare
  -- ----- EDIT THESE -----
  v_auth_user_id  uuid := '00000000-0000-0000-0000-000000000000';  -- UUID from step 2
  v_employee_no   text := '1001';
  v_first_name    text := 'First';
  v_last_name     text := 'Last';
  v_hire_date     date := current_date;
  -- ----------------------
  v_employee_id   uuid;
  v_schedule_id   uuid;
begin
  if v_auth_user_id = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Edit the values at the top of this script first.';
  end if;

  select id into v_schedule_id from work_schedules where code = '5x8';

  insert into employees (auth_user_id, employee_number, first_name, last_name,
                         role, can_enter_remotely, shuttle_eligible)
  values (v_auth_user_id, v_employee_no, v_first_name, v_last_name,
          'payroll_admin', true, false)
  returning id into v_employee_id;

  insert into employment_periods (employee_id, hire_date)
  values (v_employee_id, v_hire_date);

  insert into employee_assignments
    (employee_id, payroll_type, employee_type, schedule_id,
     holiday_eligible, effective_from)
  values
    (v_employee_id, 'semi_monthly', 'salaried', v_schedule_id,
     true, v_hire_date);

  raise notice 'Payroll admin created: % % (#%)', v_first_name, v_last_name, v_employee_no;
  raise notice 'Sign in with employee number % and the PIN you set.', v_employee_no;
end $$;
