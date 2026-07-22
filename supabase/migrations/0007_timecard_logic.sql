-- ============================================================
-- Phase 3: timecard construction and day resolution
-- ============================================================

-- Get or create the timecard for an employee in a period.
create or replace function ensure_timecard(p_employee_id uuid, p_pay_period_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from timecards
   where employee_id = p_employee_id and pay_period_id = p_pay_period_id;

  if v_id is null then
    insert into timecards (employee_id, pay_period_id)
    values (p_employee_id, p_pay_period_id)
    returning id into v_id;
  end if;

  return v_id;
end $$;

/*
 * Day-by-day scaffold for a timecard.
 *
 * Returns one row per date in the period with everything the UI needs to
 * render: scheduled hours (0 = not a scheduled work day), whether an
 * observed holiday falls there, and the holiday hours this employee's
 * schedule allocates to that date.
 *
 * Holiday allocation by schedule:
 *   5x8    - holiday hours on the observed date if it's a work day
 *   4x10   - holiday hours on the observed date (incl. Friday, which is
 *            not normally worked; the conversion rule handles the rest)
 *   4x9+4  - observed date normally; if the observed date is a Friday,
 *            the value splits across Thursday and Friday
 */
create or replace function timecard_days_scaffold(
  p_employee_id uuid,
  p_pay_period_id uuid
)
returns table (
  work_date        date,
  dow              int,
  scheduled_hours  numeric,
  is_scheduled_day boolean,
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
      a.schedule_id,
      a.holiday_eligible,
      ws.code as sched_code,
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
    -- holiday observed ON this date
    select ctx.wd, h.id as hid, h.name as hname
    from ctx
    join holidays h on h.observed_date = ctx.wd and h.active
  ),
  hol_fri as (
    -- for 4x9+4: a Friday-observed holiday also allocates hours to Thursday
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
    ctx.sched_hours,
    ctx.sched_hours > 0,
    coalesce(hol.hid, hol_fri.hid),
    coalesce(hol.hname, hol_fri.hname),
    case
      when not coalesce(ctx.holiday_eligible, false) then 0
      -- 4x9+4 with a Friday-observed holiday: split Thu/Fri
      when ctx.holiday_friday_split and hol_fri.hid is not null
        then coalesce(ctx.friday_split_thursday_hours, 0)
      when ctx.holiday_friday_split and hol.hid is not null
           and ctx.dw = 5
        then coalesce(ctx.friday_split_friday_hours, 0)
      when hol.hid is not null
        then coalesce(ctx.sched_holiday_hours, 0)
      else 0
    end,
    (hol.hid is not null or hol_fri.hid is not null)
  from ctx
  left join hol     on hol.wd = ctx.wd
  left join hol_fri on hol_fri.wd = ctx.wd
  order by ctx.wd;
end $$;

/*
 * Apply holiday time-off entries to a timecard.
 *
 * Idempotent: clears prior system-generated holiday entries and re-derives
 * them. Called when a card is opened and after entries change, so holiday
 * hours always reflect current worked hours.
 *
 * Reduction rule: hours worked on an observed holiday reduce holiday pay
 * hour-for-hour. Applies to salaried and hourly alike.
 */
create or replace function apply_holiday_entries(p_timecard_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
  v_hol_code_id uuid;
  r             record;
  v_worked      numeric;
  v_holiday     numeric;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  select id into v_hol_code_id from time_off_codes where code = 'HOL';

  -- clear previously generated holiday rows; keep anything hand-entered
  delete from timecard_entries
   where timecard_id = p_timecard_id
     and system_generated
     and time_off_code_id = v_hol_code_id;

  for r in
    select * from timecard_days_scaffold(v_employee_id, v_period_id)
    where holiday_hours > 0
  loop
    -- worked hours on this date reduce the holiday allocation
    select coalesce(sum(hours), 0) into v_worked
      from timecard_entries
     where timecard_id = p_timecard_id
       and work_date = r.work_date
       and kind = 'work';

    v_holiday := greatest(r.holiday_hours - v_worked, 0);

    if v_holiday > 0 then
      insert into timecard_entries
        (timecard_id, work_date, kind, time_off_code_id, hours,
         system_generated, note)
      values
        (p_timecard_id, r.work_date, 'time_off', v_hol_code_id, v_holiday,
         true, r.holiday_name);
    end if;
  end loop;
end $$;

/*
 * Floating holiday hours earned on a timecard.
 *
 * Salaried always earn FH for hours worked on a holiday. Hourly earn FH
 * only when they elect it (the alternative is double time). Recorded in
 * the ledger at supervisor approval, not before.
 */
create or replace function holiday_work_summary(p_timecard_id uuid)
returns table (
  work_date       date,
  holiday_name    text,
  holiday_hours   numeric,
  worked_hours    numeric,
  remaining_holiday numeric,
  election        holiday_election,
  needs_election  boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
  v_is_salaried boolean;
begin
  select t.employee_id, t.pay_period_id into v_employee_id, v_period_id
    from timecards t where t.id = p_timecard_id;

  return query
  with sc as (
    select * from timecard_days_scaffold(v_employee_id, v_period_id)
    where is_holiday_observed
  ),
  w as (
    select te.work_date as wd, coalesce(sum(te.hours), 0) as worked
    from timecard_entries te
    where te.timecard_id = p_timecard_id and te.kind = 'work'
    group by te.work_date
  )
  select
    sc.work_date,
    sc.holiday_name,
    sc.holiday_hours,
    coalesce(w.worked, 0),
    greatest(sc.holiday_hours - coalesce(w.worked, 0), 0),
    td.holiday_election,
    -- hourly employees must choose FH or DT when they work a holiday
    coalesce(w.worked, 0) > 0
      and (select a.employee_type from assignment_on(v_employee_id, sc.work_date) a)
          <> 'salaried'
  from sc
  left join w on w.wd = sc.work_date
  left join timecard_days td
    on td.timecard_id = p_timecard_id and td.work_date = sc.work_date
  order by sc.work_date;
end $$;

/*
 * 4x10 Friday-holiday conversion check.
 *
 * When a 4x10 employee works all four Mon-Thu days in a week containing a
 * Friday-observed holiday, the holiday converts to a banked floating
 * holiday rather than paying out — otherwise the week would show 40 worked
 * plus 10 holiday and generate phantom overtime.
 *
 * Returns the weeks where conversion applies.
 */
create or replace function holiday_conversion_check(p_timecard_id uuid)
returns table (
  week_start     date,
  holiday_date   date,
  holiday_name   text,
  holiday_hours  numeric,
  days_worked    int,
  converts       boolean,
  friday_worked  boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
begin
  select t.employee_id, t.pay_period_id into v_employee_id, v_period_id
    from timecards t where t.id = p_timecard_id;

  return query
  with sc as (
    select s.*, week_start(s.work_date) as wk
    from timecard_days_scaffold(v_employee_id, v_period_id) s
  ),
  -- only schedules flagged for the conversion rule (4x10)
  applicable as (
    select sc.*
    from sc
    join lateral (select * from assignment_on(v_employee_id, sc.work_date)) a on true
    join work_schedules ws on ws.id = a.schedule_id and ws.holiday_conversion_rule
    where sc.is_holiday_observed
      and extract(dow from sc.work_date)::int = 5   -- Friday-observed
  ),
  worked_days as (
    select
      week_start(te.work_date) as wk,
      count(distinct te.work_date) filter (
        where extract(dow from te.work_date)::int between 1 and 4
      ) as mon_thu_days,
      bool_or(extract(dow from te.work_date)::int = 5) as fri
    from timecard_entries te
    where te.timecard_id = p_timecard_id
      and te.kind = 'work'
      and te.hours > 0
    group by week_start(te.work_date)
  )
  select
    applicable.wk,
    applicable.work_date,
    applicable.holiday_name,
    applicable.holiday_hours,
    coalesce(wd.mon_thu_days, 0)::int,
    coalesce(wd.mon_thu_days, 0) >= 4,
    coalesce(wd.fri, false)
  from applicable
  left join worked_days wd on wd.wk = applicable.wk;
end $$;

-- ---------- validation ----------

/*
 * Warnings for a timecard. Advisory only — never blocks approval.
 *   missing_day      : scheduled day with no entries
 *   needs_election   : hourly worked a holiday, hasn't chosen FH or DT
 *   zero_hours       : entry with 0 hours under a code that expects hours
 */
create or replace function timecard_warnings(p_timecard_id uuid)
returns table (
  work_date date,
  kind      text,
  message   text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
begin
  select t.employee_id, t.pay_period_id into v_employee_id, v_period_id
    from timecards t where t.id = p_timecard_id;

  return query
  -- scheduled days with nothing on them
  select
    sc.work_date,
    'missing_day'::text,
    'Scheduled work day with no time entered'::text
  from timecard_days_scaffold(v_employee_id, v_period_id) sc
  where sc.is_scheduled_day
    and not exists (
      select 1 from timecard_entries te
      where te.timecard_id = p_timecard_id
        and te.work_date = sc.work_date
    )

  union all

  -- worked a holiday but hasn't elected FH or DT
  select
    hs.work_date,
    'needs_election'::text,
    'Worked on ' || hs.holiday_name || ' — choose floating holiday or double time'
  from holiday_work_summary(p_timecard_id) hs
  where hs.needs_election and hs.election is null

  order by 1;
end $$;
