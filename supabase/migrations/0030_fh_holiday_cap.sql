-- ============================================================
-- Phase 5s: cap floating holiday (and double time) at the day's
-- holiday hours
--
-- Floating holiday represents giving back the holiday an employee didn't
-- get to take, so it cannot exceed that day's holiday hours. A 4x9+4
-- Good Friday splits into a 5-hour Thursday portion and a 4-hour Friday
-- portion; working 9 hours over expected on the Friday should bank 4
-- (the Friday holiday), not 9.
--
-- The banked/elected amount is therefore min(excess, holiday_hours) per
-- day. This affects:
--   - post_floating_holidays  (what actually banks)
--   - apply_holiday_elections (how many hours double-time peels)
--   - print_notes             (the figure shown)
--
-- holiday_work_summary already reports excess_hours and holiday_hours,
-- so the cap is applied wherever excess was used for banking/peeling.
-- ============================================================

/*
 * The creditable hours for a worked holiday: the excess over expected,
 * capped at the day's holiday hours. This is what floating holiday banks
 * and what double time peels.
 */
create or replace function holiday_creditable_hours(
  p_excess        numeric,
  p_holiday_hours numeric
)
returns numeric
language sql immutable as $$
  select least(greatest(p_excess, 0), greatest(p_holiday_hours, 0));
$$;

-- ------------------------------------------------------------
-- Re-bank floating holidays using the capped amount.
-- ------------------------------------------------------------
create or replace function post_floating_holidays(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  r             record;
  v_credit      numeric;
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

  -- 1. floating holiday earned on hours worked beyond expected, capped at
  --    that day's holiday hours
  for r in
    select
      hs.work_date,
      hs.holiday_name,
      hs.excess_hours,
      hs.holiday_hours,
      hs.election,
      (select a.employee_type from assignment_on(v_employee_id, hs.work_date) a)
        as emp_type
    from holiday_work_summary(p_timecard_id) hs
    where hs.excess_hours > 0
  loop
    if r.emp_type = 'salaried' or r.election = 'floating_holiday' then
      v_credit := holiday_creditable_hours(r.excess_hours, r.holiday_hours);
      if v_credit > 0 then
        insert into floating_holiday_ledger
          (employee_id, hours, work_date, reason, timecard_entry_id)
        values
          (v_employee_id, v_credit, r.work_date,
           'Worked ' || r.holiday_name, null);
      end if;
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

-- ------------------------------------------------------------
-- Double-time peel: cap the peeled hours at the day's holiday hours too.
-- Working 9 over a 4-hour holiday means 4 hours at double time, not 9.
-- ------------------------------------------------------------
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

  -- for each worked holiday with double time elected, peel the creditable
  -- hours (excess capped at the day's holiday hours)
  for r in
    select * from holiday_work_summary(p_timecard_id)
    where excess_hours > 0
      and election = 'double_time'
  loop
    v_remaining := holiday_creditable_hours(r.excess_hours, r.holiday_hours);

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
-- Print notes: show the capped creditable hours, and note when the
-- worked excess exceeded the holiday (so the credit was capped).
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
        h.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from h.worked_hours::text)) ||
        ' hrs (' ||
        trim(trailing '.' from trim(trailing '0' from h.expected_hours::text)) ||
        ' expected). ' ||
        trim(trailing '.' from trim(trailing '0' from h.credit::text)) ||
        ' hrs paid at double rate' ||
        case when h.excess_hours > h.holiday_hours
             then ' (capped at the ' ||
                  trim(trailing '.' from trim(trailing '0' from h.holiday_hours::text)) ||
                  '-hr holiday)' else '' end ||
        ', the rest at regular rate.'
      else
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
