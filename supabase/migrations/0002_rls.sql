-- ============================================================
-- Row Level Security — three-tier visibility
--   employee      : own rows only
--   supervisor    : own rows + assigned reports
--   payroll_admin : everything
-- ============================================================

-- ---------- helper functions ----------

create or replace function current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from employees where auth_user_id = auth.uid()
$$;

create or replace function is_payroll_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'payroll_admin' from employees where auth_user_id = auth.uid()),
    false)
$$;

create or replace function is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('supervisor','payroll_admin') from employees where auth_user_id = auth.uid()),
    false)
$$;

-- Can the current user see this employee's data?
create or replace function can_view_employee(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_payroll_admin()
    or target = current_employee_id()
    or exists (
      select 1 from supervisor_assignments sa
      where sa.employee_id = target
        and sa.supervisor_id = current_employee_id()
    )
$$;

-- Supervisors and admins may edit; employees may edit only their own
-- open / employee_approved cards.
create or replace function can_edit_employee(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_payroll_admin()
    or exists (
      select 1 from supervisor_assignments sa
      where sa.employee_id = target
        and sa.supervisor_id = current_employee_id()
    )
    or target = current_employee_id()
$$;

-- ---------- enable RLS ----------

alter table employees               enable row level security;
alter table employment_periods      enable row level security;
alter table employee_assignments    enable row level security;
alter table employee_work_codes     enable row level security;
alter table employee_time_off_codes enable row level security;
alter table supervisor_assignments  enable row level security;
alter table timecards               enable row level security;
alter table timecard_entries        enable row level security;
alter table timecard_days           enable row level security;
alter table balance_snapshots       enable row level security;
alter table floating_holiday_ledger enable row level security;
alter table workweek_ledger         enable row level security;
alter table year_end_runs           enable row level security;
alter table year_end_results        enable row level security;
alter table audit_log               enable row level security;
alter table network_allowlist       enable row level security;
alter table grants                  enable row level security;
alter table pay_periods             enable row level security;

-- Config tables: readable by all authenticated, writable by admin
alter table work_codes               enable row level security;
alter table time_off_codes           enable row level security;
alter table work_schedules           enable row level security;
alter table work_schedule_days       enable row level security;
alter table holidays                 enable row level security;
alter table shuttle_incentive_levels enable row level security;
alter table year_end_config          enable row level security;

-- ---------- config: read-all / admin-write ----------

do $$
declare t text;
begin
  foreach t in array array[
    'work_codes','time_off_codes','work_schedules','work_schedule_days',
    'holidays','shuttle_incentive_levels','year_end_config','pay_periods'
  ]
  loop
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated using (true);
      create policy %1$s_write on %1$s for all to authenticated
        using (is_payroll_admin()) with check (is_payroll_admin());
    $f$, t);
  end loop;
end $$;

-- ---------- employees ----------

create policy employees_read on employees for select to authenticated
  using (can_view_employee(id));

create policy employees_admin_write on employees for all to authenticated
  using (is_payroll_admin()) with check (is_payroll_admin());

-- ---------- employee-scoped reference tables ----------

do $$
declare t text;
begin
  foreach t in array array[
    'employment_periods','employee_assignments','employee_work_codes',
    'employee_time_off_codes','balance_snapshots','floating_holiday_ledger',
    'workweek_ledger'
  ]
  loop
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated
        using (can_view_employee(employee_id));
      create policy %1$s_write on %1$s for all to authenticated
        using (is_payroll_admin()) with check (is_payroll_admin());
    $f$, t);
  end loop;
end $$;

-- supervisor_assignments: visible if you can see the employee, or you are the supervisor
create policy supervisor_assignments_read on supervisor_assignments for select to authenticated
  using (can_view_employee(employee_id) or supervisor_id = current_employee_id());

create policy supervisor_assignments_write on supervisor_assignments for all to authenticated
  using (is_payroll_admin()) with check (is_payroll_admin());

-- ---------- timecards ----------

create policy timecards_read on timecards for select to authenticated
  using (can_view_employee(employee_id));

-- Employees may create their own card; supervisors/admins may create for reports
create policy timecards_insert on timecards for insert to authenticated
  with check (can_edit_employee(employee_id));

-- Employees can update their own card only while not exported;
-- supervisors and admins are not blocked by employee approval.
create policy timecards_update on timecards for update to authenticated
  using (
    can_edit_employee(employee_id)
    and (
      is_supervisor()
      or (employee_id = current_employee_id() and status in ('open','employee_approved'))
    )
  )
  with check (can_edit_employee(employee_id));

create policy timecards_delete on timecards for delete to authenticated
  using (is_payroll_admin());

-- ---------- timecard entries ----------

create policy timecard_entries_read on timecard_entries for select to authenticated
  using (exists (
    select 1 from timecards tc
    where tc.id = timecard_entries.timecard_id
      and can_view_employee(tc.employee_id)
  ));

create policy timecard_entries_write on timecard_entries for all to authenticated
  using (exists (
    select 1 from timecards tc
    where tc.id = timecard_entries.timecard_id
      and can_edit_employee(tc.employee_id)
      and (
        is_supervisor()
        or (tc.employee_id = current_employee_id() and tc.status in ('open','employee_approved'))
      )
      and tc.status <> 'exported'
  ))
  with check (exists (
    select 1 from timecards tc
    where tc.id = timecard_entries.timecard_id
      and can_edit_employee(tc.employee_id)
      and tc.status <> 'exported'
  ));

-- ---------- timecard days ----------

create policy timecard_days_read on timecard_days for select to authenticated
  using (exists (
    select 1 from timecards tc
    where tc.id = timecard_days.timecard_id
      and can_view_employee(tc.employee_id)
  ));

create policy timecard_days_write on timecard_days for all to authenticated
  using (exists (
    select 1 from timecards tc
    where tc.id = timecard_days.timecard_id
      and can_edit_employee(tc.employee_id)
      and tc.status <> 'exported'
  ))
  with check (exists (
    select 1 from timecards tc
    where tc.id = timecard_days.timecard_id
      and can_edit_employee(tc.employee_id)
      and tc.status <> 'exported'
  ));

-- ---------- audit log ----------

create policy audit_log_read on audit_log for select to authenticated
  using (subject_employee_id is null and is_payroll_admin()
         or can_view_employee(subject_employee_id));

-- inserts happen via trigger (security definer); no direct client writes

-- ---------- admin-only tables ----------

do $$
declare t text;
begin
  foreach t in array array['network_allowlist','grants','year_end_runs','year_end_results']
  loop
    execute format($f$
      create policy %1$s_admin on %1$s for all to authenticated
        using (is_payroll_admin()) with check (is_payroll_admin());
    $f$, t);
  end loop;
end $$;

-- year_end_results additionally readable by the employee it concerns
create policy year_end_results_self_read on year_end_results for select to authenticated
  using (can_view_employee(employee_id));

-- grants readable by all (they drive the timecard display)
create policy grants_read on grants for select to authenticated using (true);
