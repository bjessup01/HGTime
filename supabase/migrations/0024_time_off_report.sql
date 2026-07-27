-- ============================================================
-- Phase 5m: time-off report
-- ============================================================

/*
 * Time off taken in a date range, one row per employee per code per day.
 *
 * p_codes null means all time-off codes; otherwise only the codes whose
 * ids are in the array. Holiday hours that the system generates are
 * excluded - this reports time employees TOOK, not holiday allocations.
 * System-generated holiday lines carry system_generated = true, so
 * filtering them keeps the report to entries someone actually entered.
 *
 * Sorted last name, first name, date - the reading order asked for.
 */
create or replace function time_off_report(
  p_from  date,
  p_to    date,
  p_codes uuid[] default null
)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  work_date       date,
  code            text,
  description     text,
  hours           numeric,
  unpaid          boolean
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    te.work_date,
    toc.code,
    toc.description,
    te.hours,
    te.unpaid
  from timecard_entries te
  join timecards tc     on tc.id = te.timecard_id
  join employees e      on e.id = tc.employee_id
  join time_off_codes toc on toc.id = te.time_off_code_id
  where is_payroll_admin()
    and te.kind = 'time_off'
    and not te.system_generated
    and te.hours > 0
    and te.work_date between p_from and p_to
    and (p_codes is null or toc.id = any(p_codes))
  order by e.last_name, e.first_name, te.work_date, toc.sort_order
$$;

/*
 * Totals by code across everyone, for the same filters. Bottom of the
 * report.
 */
create or replace function time_off_report_totals(
  p_from  date,
  p_to    date,
  p_codes uuid[] default null
)
returns table (
  code        text,
  description text,
  total_hours numeric,
  sort_order  int
)
language sql stable security definer set search_path = public as $$
  select
    toc.code,
    toc.description,
    sum(te.hours),
    toc.sort_order
  from timecard_entries te
  join time_off_codes toc on toc.id = te.time_off_code_id
  where is_payroll_admin()
    and te.kind = 'time_off'
    and not te.system_generated
    and te.hours > 0
    and te.work_date between p_from and p_to
    and (p_codes is null or toc.id = any(p_codes))
  group by toc.code, toc.description, toc.sort_order
  order by toc.sort_order, toc.code
$$;
