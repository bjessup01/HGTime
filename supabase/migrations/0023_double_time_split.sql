-- ============================================================
-- Phase 5l: double-time split + holiday summary consistency
--
-- Two problems, both around a holiday worked with double time elected.
--
--   1. holiday_work_summary returned remaining_holiday = holiday - worked,
--      but apply_holiday_entries and the actual card reduce the holiday
--      by the EXCESS over expected work, not by total worked. The
--      function also lacked an excess_hours column that print_notes and
--      the salaried summary already reference — so those notes were
--      reading a column that did not exist as intended.
--
--   2. Electing double time never split the worked entry. The whole
--      worked line stayed as one entry with the double_time flag applied
--      to all of it, instead of peeling only the excess hours into a
--      separate double_time line.
--
-- The model, confirmed against a 4x9+4 Thursday (scheduled 9, holiday 5,
-- worked 6):
--
--     expected work = scheduled - holiday      = 4   (paid regular)
--     excess        = worked - expected        = 2   (DT if elected)
--     holiday       = holiday - excess         = 3
--
--     the 6-hour worked line splits into 4 regular + 2 double-time
-- ============================================================

-- Return type is changing (new columns), and Postgres cannot alter that
-- in place. Drop in dependency order: everything that calls
-- holiday_work_summary first, then the function itself.
drop function if exists print_notes(uuid);
drop function if exists post_floating_holidays(uuid);
drop function if exists salaried_warnings(uuid);
drop function if exists holiday_work_summary(uuid);

/*
 * Holiday work summary, corrected.
 *
 * expected_hours   the non-holiday portion of a scheduled day; hours up
 *                  to this are ordinary work and do not touch the holiday
 * excess_hours     hours worked beyond expected; these reduce the holiday
 *                  hour-for-hour and are what a DT/FH election acts on
 * remaining_holiday holiday_hours - excess_hours (never below zero)
 */
create or replace function holiday_work_summary(p_timecard_id uuid)
returns table (
  work_date         date,
  holiday_name      text,
  holiday_hours     numeric,
  worked_hours      numeric,
  expected_hours    numeric,
  excess_hours      numeric,
  remaining_holiday numeric,
  election          holiday_election,
  needs_election    boolean
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
    select * from timecard_days_scaffold(v_employee_id, v_period_id)
    where is_holiday_observed
  ),
  w as (
    -- worked hours excluding any the DT split already peeled off, so the
    -- summary is stable whether or not the split has run
    select te.work_date as wd, coalesce(sum(te.hours), 0) as worked
    from timecard_entries te
    where te.timecard_id = p_timecard_id and te.kind = 'work'
    group by te.work_date
  ),
  base as (
    select
      sc.work_date,
      sc.holiday_name,
      sc.holiday_hours,
      coalesce(w.worked, 0) as worked,
      -- expected = the part of the scheduled day that is not holiday
      greatest(sc.scheduled_hours - sc.holiday_hours, 0) as expected,
      td.holiday_election,
      (select a.employee_type from assignment_on(v_employee_id, sc.work_date) a)
        as emp_type
    from sc
    left join w on w.wd = sc.work_date
    left join timecard_days td
      on td.timecard_id = p_timecard_id and td.work_date = sc.work_date
  )
  select
    base.work_date,
    base.holiday_name,
    base.holiday_hours,
    base.worked,
    base.expected,
    greatest(base.worked - base.expected, 0),                       -- excess
    greatest(base.holiday_hours - greatest(base.worked - base.expected, 0), 0),
    base.holiday_election,
    greatest(base.worked - base.expected, 0) > 0
      and base.emp_type <> 'salaried'
  from base
  order by base.work_date;
end $$;

/*
 * apply_holiday_entries, corrected to reduce the holiday by the excess
 * over expected work rather than by total worked hours.
 *
 * A 4x9+4 Thursday scheduled 9 with a 5-hour holiday expects 4 hours of
 * ordinary work. Working 6 means 2 excess, so the holiday drops to 3 -
 * not to zero, which is what "holiday - worked" produced.
 */
create or replace function apply_holiday_entries(p_timecard_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
  v_hol_code_id uuid;
  r             record;
  v_worked      numeric;
  v_expected    numeric;
  v_excess      numeric;
  v_holiday     numeric;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  select id into v_hol_code_id from time_off_codes where code = 'HOL';

  delete from timecard_entries
   where timecard_id = p_timecard_id
     and system_generated
     and time_off_code_id = v_hol_code_id;

  for r in
    select * from timecard_days_scaffold(v_employee_id, v_period_id)
    where holiday_hours > 0
  loop
    select coalesce(sum(hours), 0) into v_worked
      from timecard_entries
     where timecard_id = p_timecard_id
       and work_date = r.work_date
       and kind = 'work';

    v_expected := greatest(r.scheduled_hours - r.holiday_hours, 0);
    v_excess   := greatest(v_worked - v_expected, 0);
    v_holiday  := greatest(r.holiday_hours - v_excess, 0);

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
 * Apply the double-time / floating-holiday election for a holiday.
 *
 * Called after an election is set or an entry changes. For each holiday
 * the employee worked past the expected hours:
 *
 *   - double_time: peel the excess hours off the worked line into a
 *     separate line flagged double_time, leaving the expected hours as
 *     ordinary work. Payroll doubles the rate on the flagged line.
 *   - floating_holiday (or salaried): leave the worked entries alone;
 *     the floating holiday is banked at approval.
 *
 * Re-running is safe: any prior double_time split is folded back first,
 * so the function always works from the employee's actual worked total.
 */
create or replace function apply_holiday_elections(p_timecard_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  r             record;
  v_work_entry  record;
  v_remaining   numeric;
  v_peel        numeric;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  -- 1. fold any existing double_time splits back into their base lines,
  --    so we start from the true worked hours regardless of prior runs
  for v_work_entry in
    select dt.id, dt.work_date, dt.work_code_id, dt.hours
    from timecard_entries dt
    where dt.timecard_id = p_timecard_id
      and dt.kind = 'work'
      and dt.double_time
  loop
    -- add the peeled hours back to the matching regular line if one
    -- exists, otherwise just clear the flag on this line
    update timecard_entries base
       set hours = base.hours + v_work_entry.hours
     where base.timecard_id = p_timecard_id
       and base.work_date = v_work_entry.work_date
       and base.work_code_id = v_work_entry.work_code_id
       and base.kind = 'work'
       and not base.double_time
       and base.id <> v_work_entry.id;

    if found then
      delete from timecard_entries where id = v_work_entry.id;
    else
      update timecard_entries set double_time = false
       where id = v_work_entry.id;
    end if;
  end loop;

  -- 2. for each worked holiday with double time elected, peel the excess
  for r in
    select * from holiday_work_summary(p_timecard_id)
    where excess_hours > 0
      and election = 'double_time'
  loop
    v_remaining := r.excess_hours;

    -- peel from the last work code worked that day, working backwards,
    -- so a multi-code day splits predictably
    for v_work_entry in
      select id, work_code_id, hours
      from timecard_entries
      where timecard_id = p_timecard_id
        and work_date = r.work_date
        and kind = 'work'
        and not double_time
      order by hours desc, id
    loop
      exit when v_remaining <= 0;

      v_peel := least(v_work_entry.hours, v_remaining);

      if v_peel >= v_work_entry.hours then
        -- entire line becomes double time
        update timecard_entries set double_time = true
         where id = v_work_entry.id;
      else
        -- split: reduce the base line, add a double_time line
        update timecard_entries
           set hours = hours - v_peel
         where id = v_work_entry.id;

        insert into timecard_entries
          (timecard_id, work_date, kind, work_code_id, hours, double_time, note)
        values
          (p_timecard_id, r.work_date, 'work', v_work_entry.work_code_id,
           v_peel, true, 'Double time (holiday)');
      end if;

      v_remaining := v_remaining - v_peel;
    end loop;
  end loop;
end $$;

/*
 * Printed notes: reference the DT portion by the excess hours, and name
 * the split explicitly. Rewritten here so it reads from the corrected
 * summary columns.
 */
create or replace function print_notes(p_timecard_id uuid)
returns table (
  work_date  date,
  note_type  text,
  note_text  text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  return query
  select
    hs.work_date,
    case
      when hs.election = 'double_time' then 'double_time'
      else 'floating_holiday'
    end,
    case
      when hs.election = 'double_time' then
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.worked_hours::text)) ||
        ' hrs (' ||
        trim(trailing '.' from trim(trailing '0' from hs.expected_hours::text)) ||
        ' expected). ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs over, elected DOUBLE TIME — ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs paid at double rate, the rest at regular rate.'
      when hs.election = 'floating_holiday' then
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs over expected, elected FLOATING HOLIDAY (' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs banked).'
      else
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs over expected, floating holiday added (' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs banked).'
    end
  from holiday_work_summary(p_timecard_id) hs
  where hs.excess_hours > 0
    and (
      hs.election is not null
      or (select a.employee_type
          from assignment_on(v_employee_id, hs.work_date) a) = 'salaried'
    )

  union all

  select
    cc.holiday_date,
    'conversion',
    cc.holiday_name || ' — worked ' || cc.days_worked ||
    ' days this week, holiday converted to floating holiday (' ||
    trim(trailing '.' from trim(trailing '0' from cc.holiday_hours::text)) ||
    ' hrs banked).'
  from holiday_conversion_check(p_timecard_id) cc
  where cc.converts

  order by 1;
end $$;

/*
 * post_floating_holidays banked worked_hours, but floating holiday is
 * earned on the EXCESS over expected work, not the whole worked amount.
 * A 4x9+4 Thursday working 6 of a 9-hour day (5 holiday, 4 expected)
 * banks 2 hours, not 6.
 *
 * Only the loop over worked holidays changes; the 4x10 conversion and
 * clearing logic are unchanged, so this redefine keeps them intact.
 */
create or replace function post_floating_holidays(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  r             record;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  delete from floating_holiday_ledger
   where employee_id = v_employee_id
     and timecard_entry_id in (
       select id from timecard_entries where timecard_id = p_timecard_id
     );

  delete from floating_holiday_ledger
   where employee_id = v_employee_id
     and timecard_entry_id is null
     and reason like 'Converted:%'
     and work_date in (
       select s.work_date
       from timecards tc
       join timecard_days_scaffold(tc.employee_id, tc.pay_period_id) s on true
       where tc.id = p_timecard_id
     );

  -- 1. floating holiday earned on hours worked BEYOND expected
  for r in
    select
      hs.work_date,
      hs.holiday_name,
      hs.excess_hours,
      hs.election,
      (select a.employee_type from assignment_on(v_employee_id, hs.work_date) a)
        as emp_type
    from holiday_work_summary(p_timecard_id) hs
    where hs.excess_hours > 0
  loop
    if r.emp_type = 'salaried' or r.election = 'floating_holiday' then
      insert into floating_holiday_ledger
        (employee_id, hours, work_date, reason, timecard_entry_id)
      values
        (v_employee_id, r.excess_hours, r.work_date,
         'Worked ' || r.holiday_name, null);
    end if;
  end loop;

  -- 2. 4x10 Friday-holiday conversion (unchanged)
  for r in
    select * from holiday_conversion_check(p_timecard_id) where converts
  loop
    insert into floating_holiday_ledger
      (employee_id, hours, work_date, reason, timecard_entry_id)
    values
      (v_employee_id, r.holiday_hours, r.holiday_date,
       'Converted: ' || r.holiday_name || ' (worked ' || r.days_worked || ' days)',
       null);
  end loop;
end $$;

/*
 * salaried_warnings is recreated here because it depends on
 * holiday_work_summary, which was dropped and rebuilt above. Definition
 * is unchanged from 0010; it already reads excess_hours.
 */
create or replace function salaried_warnings(p_timecard_id uuid)
returns table (
  work_date date,
  kind      text,
  message   text
)
language sql stable security definer set search_path = public as $$
  select
    st.work_date,
    'pending_day'::text,
    'Scheduled day not yet confirmed'::text
  from salaried_day_status(p_timecard_id) st
  where st.status = 'pending'

  union all

  select
    hs.work_date,
    'holiday_worked'::text,
    'Worked ' || hs.excess_hours || 'h on ' || hs.holiday_name ||
      ' — floating holiday will be added'
  from holiday_work_summary(p_timecard_id) hs
  where hs.excess_hours > 0

  order by 1
$$;
