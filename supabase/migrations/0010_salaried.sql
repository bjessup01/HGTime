-- ============================================================
-- Phase 5a: salaried entry path
-- ============================================================

/*
 * Confirm a single day as worked-as-scheduled.
 *
 * Salaried employees do not enter hours for ordinary days - they
 * confirm the day matched their schedule. Confirmation is recorded
 * on timecard_days, not as an entry, so the export can emit the flat
 * 80 hours while the card still shows who confirmed what and when.
 */
create or replace function confirm_salaried_day(
  p_timecard_id uuid,
  p_work_date   date,
  p_confirmed   boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into timecard_days (timecard_id, work_date, salaried_confirmed)
  values (p_timecard_id, p_work_date, p_confirmed)
  on conflict (timecard_id, work_date)
  do update set salaried_confirmed = excluded.salaried_confirmed;
end $$;

/*
 * Confirm every remaining scheduled day in one action.
 *
 * Skips days that already carry time off or holiday work - those were
 * handled explicitly and should not be silently marked as normal.
 * This is the one-click path for a period with no exceptions, while
 * still requiring the employee to actively take it.
 */
create or replace function confirm_remaining_salaried_days(p_timecard_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
  v_count       int := 0;
  r             record;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  for r in
    select s.work_date
    from timecard_days_scaffold(v_employee_id, v_period_id) s
    where s.is_scheduled_day
      and not exists (
        select 1 from timecard_entries te
        where te.timecard_id = p_timecard_id
          and te.work_date = s.work_date
      )
      and not exists (
        select 1 from timecard_days td
        where td.timecard_id = p_timecard_id
          and td.work_date = s.work_date
          and td.salaried_confirmed
      )
  loop
    perform confirm_salaried_day(p_timecard_id, r.work_date, true);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

/*
 * Per-day status for a salaried timecard.
 *
 * Each scheduled day is in exactly one state:
 *   confirmed  - employee confirmed they worked it normally
 *   exception  - has time off, or holiday work, entered explicitly
 *   pending    - neither; needs the employee's attention
 */
create or replace function salaried_day_status(p_timecard_id uuid)
returns table (
  work_date       date,
  scheduled_hours numeric,
  is_scheduled_day boolean,
  is_employed     boolean,
  holiday_hours   numeric,
  holiday_name    text,
  entry_hours     numeric,
  worked_hours    numeric,
  time_off_hours  numeric,
  confirmed       boolean,
  status          text
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
    select s.* from timecard_days_scaffold(v_employee_id, v_period_id) s
  ),
  agg as (
    select
      te.work_date as wd,
      coalesce(sum(te.hours), 0) as total,
      coalesce(sum(te.hours) filter (where te.kind = 'work'), 0) as worked,
      coalesce(sum(te.hours) filter (where te.kind = 'time_off'), 0) as timeoff
    from timecard_entries te
    where te.timecard_id = p_timecard_id
    group by te.work_date
  )
  select
    sc.work_date,
    sc.scheduled_hours,
    sc.is_scheduled_day,
    sc.is_employed,
    sc.holiday_hours,
    sc.holiday_name,
    coalesce(agg.total, 0),
    coalesce(agg.worked, 0),
    coalesce(agg.timeoff, 0),
    coalesce(td.salaried_confirmed, false),
    case
      when not sc.is_employed then 'not_employed'
      when not sc.is_scheduled_day and coalesce(agg.total, 0) = 0 then 'not_scheduled'
      when coalesce(agg.total, 0) > 0 then 'exception'
      when coalesce(td.salaried_confirmed, false) then 'confirmed'
      else 'pending'
    end
  from sc
  left join agg on agg.wd = sc.work_date
  left join timecard_days td
    on td.timecard_id = p_timecard_id and td.work_date = sc.work_date
  order by sc.work_date;
end $$;

/*
 * Salaried period summary.
 *
 * Salaried employees are paid a flat 80 hours per semi-monthly period
 * regardless of hours actually worked. Time off is reported alongside
 * so payroll can draw the right banks - it does not add to the 80.
 */
create or replace function salaried_summary(p_timecard_id uuid)
returns table (
  scheduled_days    int,
  confirmed_days    int,
  exception_days    int,
  pending_days      int,
  time_off_hours    numeric,
  holiday_hours     numeric,
  actual_worked     numeric,
  base_period_hours numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  -- Salaried employees exist only on semi-monthly payroll, which pays
  -- a flat 80 hours per period regardless of hours actually worked.
  v_base numeric := 80;
begin
  return query
  with st as (
    select * from salaried_day_status(p_timecard_id)
  )
  select
    count(*) filter (where st.is_scheduled_day)::int,
    count(*) filter (where st.status = 'confirmed')::int,
    count(*) filter (where st.status = 'exception')::int,
    count(*) filter (where st.status = 'pending')::int,
    coalesce(sum(st.time_off_hours), 0),
    coalesce(sum(st.holiday_hours), 0),
    coalesce(sum(st.worked_hours), 0),
    v_base
  from st;
end $$;

/*
 * Warnings for a salaried timecard.
 *
 * Unlike the hourly path, a salaried day with nothing on it is only a
 * problem if it was also never confirmed - confirmation IS the entry.
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
