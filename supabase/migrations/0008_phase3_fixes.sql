-- ============================================================
-- 0008: fixes applied directly in the SQL Editor during Phase 3
--
-- These were run by hand while debugging. Captured here so a fresh
-- rebuild from migrations reproduces the current database exactly.
-- Safe to re-run: everything is create-or-replace.
-- ============================================================

-- ------------------------------------------------------------
-- FIX 1: audit trigger crashed on the timecards table.
--
-- The function ran for timecards, timecard_entries, and timecard_days,
-- but read old.timecard_id / new.timecard_id unconditionally. The
-- timecards table has no such column (it IS the timecard), so any
-- insert raised: record "old" has no field "timecard_id".
-- ------------------------------------------------------------

create or replace function log_timecard_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_timecard_id uuid;
  v_employee_id uuid;
  v_actor_id    uuid;
begin
  v_actor_id := current_employee_id();

  if tg_table_name = 'timecards' then
    -- the timecards row IS the card; it has no timecard_id column
    v_employee_id := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  else
    v_timecard_id := case when tg_op = 'DELETE' then old.timecard_id else new.timecard_id end;
    select employee_id into v_employee_id from timecards where id = v_timecard_id;
  end if;

  insert into audit_log (table_name, record_id, action, actor_id, subject_employee_id,
                         before_data, after_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    v_actor_id,
    v_employee_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ------------------------------------------------------------
-- FIX 2: scaffold now reports employment status per day.
--
-- Days outside an employment period render greyed out as "not
-- employed" rather than looking like ordinary unscheduled days.
-- Holiday hours are also suppressed outside employment, so a new
-- hire starting the 15th does not receive holiday pay for the 12th.
-- ------------------------------------------------------------

drop function if exists timecard_days_scaffold(uuid, uuid);

create or replace function timecard_days_scaffold(
  p_employee_id uuid,
  p_pay_period_id uuid
)
returns table (
  work_date        date,
  dow              int,
  scheduled_hours  numeric,
  is_scheduled_day boolean,
  is_employed      boolean,
  holiday_id       uuid,
  holiday_name     text,
  holiday_hours    numeric,
  is_holiday_observed boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date;
  v_end   date;
begin
  select start_date, end_date into v_start, v_end
    from pay_periods where id = p_pay_period_id;

  if v_start is null then
    raise exception 'Unknown pay period %', p_pay_period_id;
  end if;

  return query
  with days as (
    select d::date as wd from generate_series(v_start, v_end, interval '1 day') d
  ),
  ctx as (
    select
      days.wd,
      extract(dow from days.wd)::int as dw,
      employed_on(p_employee_id, days.wd) as employed,
      a.schedule_id,
      a.holiday_eligible,
      ws.holiday_hours as sched_holiday_hours,
      ws.holiday_friday_split,
      ws.friday_split_thursday_hours,
      ws.friday_split_friday_hours,
      coalesce(wsd.scheduled_hours, 0) as sched_hours
    from days
    left join lateral (select * from assignment_on(p_employee_id, days.wd)) a on true
    left join work_schedules ws on ws.id = a.schedule_id
    left join work_schedule_days wsd
      on wsd.schedule_id = a.schedule_id
     and wsd.dow = extract(dow from days.wd)::int
  ),
  hol as (
    select ctx.wd, h.id as hid, h.name as hname
    from ctx
    join holidays h on h.observed_date = ctx.wd and h.active
  ),
  hol_fri as (
    -- 4x9+4 only: a Friday-observed holiday also allocates hours to Thursday
    select ctx.wd, h.id as hid, h.name as hname
    from ctx
    join holidays h
      on h.active
     and h.observed_date = ctx.wd + 1
     and extract(dow from h.observed_date)::int = 5
    where ctx.holiday_friday_split
      and extract(dow from ctx.wd)::int = 4
  )
  select
    ctx.wd,
    ctx.dw,
    case when ctx.employed then ctx.sched_hours else 0 end,
    ctx.employed and ctx.sched_hours > 0,
    ctx.employed,
    coalesce(hol.hid, hol_fri.hid),
    coalesce(hol.hname, hol_fri.hname),
    case
      when not ctx.employed then 0
      when not coalesce(ctx.holiday_eligible, false) then 0
      when ctx.holiday_friday_split and hol_fri.hid is not null
        then coalesce(ctx.friday_split_thursday_hours, 0)
      when ctx.holiday_friday_split and hol.hid is not null and ctx.dw = 5
        then coalesce(ctx.friday_split_friday_hours, 0)
      when hol.hid is not null
        then coalesce(ctx.sched_holiday_hours, 0)
      else 0
    end,
    -- the Thursday split day counts as a holiday day for election purposes
    (hol.hid is not null or hol_fri.hid is not null) and ctx.employed
  from ctx
  left join hol     on hol.wd = ctx.wd
  left join hol_fri on hol_fri.wd = ctx.wd
  order by ctx.wd;
end $$;

-- ------------------------------------------------------------
-- FIX 3: changing an employee's default work code should also add
-- it to their usable list, so the entry dropdown can preselect it.
-- ------------------------------------------------------------

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

  -- the default code is always usable
  if v_work_code_id is not null then
    insert into employee_work_codes (employee_id, work_code_id)
    values (p_employee_id, v_work_code_id)
    on conflict do nothing;
  end if;

  return v_new_id;
end $$;
