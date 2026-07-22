-- ============================================================
-- Phase 5d: holiday notes on printed timecards
-- ============================================================

/*
 * Notes for the printed card.
 *
 * Three things the processor needs to see that are not otherwise
 * visible in the detail table:
 *
 *   1. DOUBLE TIME elections - names the work code and hours to pay at
 *      double rate. The detail table shows two lines under the same
 *      code, so the note has to say which one.
 *
 *   2. FLOATING HOLIDAY elections - informational; the app already
 *      banked the hours, but the processor should know the choice was
 *      made deliberately.
 *
 *   3. 4x10 conversions - explains why holiday hours are absent. A
 *      processor comparing against a prior period would otherwise see
 *      a missing holiday and wonder.
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
  -- ---- holiday work elections ----
  select
    hs.work_date,
    case
      when hs.election = 'double_time' then 'double_time'
      else 'floating_holiday'
    end,
    case
      when hs.election = 'double_time' then
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs, elected DOUBLE TIME. ' ||
        coalesce((
          -- the codes carrying the doubled hours
          select string_agg(
            trim(trailing '.' from trim(trailing '0' from te.hours::text)) ||
            ' hrs under ' || wc.code, ', ')
          from timecard_entries te
          join work_codes wc on wc.id = te.work_code_id
          where te.timecard_id = p_timecard_id
            and te.work_date = hs.work_date
            and te.kind = 'work'
            and te.double_time
        ), '') ||
        ' to be paid at double rate.'
      when hs.election = 'floating_holiday' then
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs, elected FLOATING HOLIDAY (' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs banked).'
      else
        -- salaried: no election is offered, floating holiday is automatic
        hs.holiday_name || ' — worked ' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs, floating holiday added (' ||
        trim(trailing '.' from trim(trailing '0' from hs.excess_hours::text)) ||
        ' hrs banked).'
    end
  from holiday_work_summary(p_timecard_id) hs
  where hs.excess_hours > 0
    and (
      hs.election is not null
      -- salaried always bank a floating holiday; no election to make
      or (select a.employee_type
          from assignment_on(v_employee_id, hs.work_date) a) = 'salaried'
    )

  union all

  -- ---- 4x10 Friday-holiday conversions ----
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
