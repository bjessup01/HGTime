-- ============================================================
-- Phase 5t: double time is NOT capped at holiday hours
--
-- 0030 capped both floating holiday AND double time at the day's holiday
-- hours. That is correct for floating holiday - it gives back the holiday
-- you didn't take, so it can't exceed the holiday. But double time is
-- premium pay for actually WORKING the holiday: every hour worked over
-- expected is real work and earns double time. An 8-hour holiday worked
-- 9 hours over expected = 9 hours of double time, not 8.
--
-- So:
--   floating holiday banked = min(excess, holiday_hours)   (capped)
--   double time hours       = excess                        (uncapped)
--
-- This restores double time to the full excess while keeping the floating
-- holiday cap from 0030.
-- ============================================================

/*
 * Double-time peel: the FULL excess over expected, uncapped. Floating
 * holiday still uses holiday_creditable_hours (the capped amount) in
 * post_floating_holidays, which is unchanged.
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

  -- fold any existing double_time splits back into their base lines first
  for v_work_entry in
    select dt.id, dt.work_date, dt.work_code_id, dt.hours
    from timecard_entries dt
    where dt.timecard_id = p_timecard_id
      and dt.kind = 'work'
      and dt.double_time
  loop
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

  -- for each worked holiday with double time elected, peel the FULL excess
  -- over expected - every worked hour past expected earns double time
  for r in
    select * from holiday_work_summary(p_timecard_id)
    where excess_hours > 0
      and election = 'double_time'
  loop
    v_remaining := r.excess_hours;   -- uncapped

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
        update timecard_entries set double_time = true
         where id = v_work_entry.id;
      else
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

-- ------------------------------------------------------------
-- Print notes: double time shows the full excess; floating holiday shows
-- the capped credit (and notes when it was capped). Only the double_time
-- branch changes from 0030.
-- ------------------------------------------------------------
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
  with h as (
    select
      hs.*,
      holiday_creditable_hours(hs.excess_hours, hs.holiday_hours) as credit
    from holiday_work_summary(p_timecard_id) hs
    where hs.excess_hours > 0
  )
  select
    h.work_date,
    case when h.election = 'double_time' then 'double_time'
         else 'floating_holiday' end,
    case
      when h.election = 'double_time' then
        -- double time is uncapped: the full excess is paid at double rate
        h.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from h.worked_hours::text)) ||
        ' hrs (' ||
        trim(trailing '.' from trim(trailing '0' from h.expected_hours::text)) ||
        ' expected). ' ||
        trim(trailing '.' from trim(trailing '0' from h.excess_hours::text)) ||
        ' hrs paid at double rate, the rest at regular rate.'
      else
        -- floating holiday is capped at the day's holiday hours
        h.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from h.excess_hours::text)) ||
        ' hrs over expected, floating holiday added (' ||
        trim(trailing '.' from trim(trailing '0' from h.credit::text)) ||
        ' hrs banked' ||
        case when h.excess_hours > h.holiday_hours
             then ', capped at the ' ||
                  trim(trailing '.' from trim(trailing '0' from h.holiday_hours::text)) ||
                  '-hr holiday' else '' end ||
        ').'
    end
  from h
  where h.election is not null
     or (select a.employee_type
         from assignment_on(v_employee_id, h.work_date) a) = 'salaried'

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
