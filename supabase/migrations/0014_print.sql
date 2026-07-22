-- ============================================================
-- Phase 5c: printable timecard
-- ============================================================

/*
 * The overtime period for a printed card.
 *
 * Overtime is calculated on Sunday-Saturday workweeks, so when a pay
 * period starts mid-week the printed card must show the earlier days
 * of that week for context. They are marked with an asterisk and
 * excluded from period totals.
 *
 * Returns the Sunday of the week containing the period start through
 * the period end.
 */
create or replace function overtime_period(p_pay_period_id uuid)
returns table (ot_start date, ot_end date)
language sql stable security definer set search_path = public as $$
  select week_start(pp.start_date), pp.end_date
  from pay_periods pp
  where pp.id = p_pay_period_id
$$;

/*
 * Work entry lines for a printed card, including prior-period days
 * that fall in the same workweek as the period start.
 *
 * is_prior marks rows shown for overtime context only.
 */
create or replace function print_work_lines(p_timecard_id uuid)
returns table (
  work_date     date,
  work_code     text,
  description   text,
  start_time    time,
  end_time      time,
  hours         numeric,
  double_time   boolean,
  is_prior      boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_start       date;
  v_end         date;
  v_ot_start    date;
begin
  select tc.employee_id, pp.start_date, pp.end_date
    into v_employee_id, v_start, v_end
  from timecards tc
  join pay_periods pp on pp.id = tc.pay_period_id
  where tc.id = p_timecard_id;

  v_ot_start := week_start(v_start);

  return query
  select
    te.work_date,
    wc.code,
    wc.description,
    te.start_time,
    te.end_time,
    te.hours,
    te.double_time,
    te.work_date < v_start
  from timecard_entries te
  join timecards tc2 on tc2.id = te.timecard_id
  left join work_codes wc on wc.id = te.work_code_id
  where tc2.employee_id = v_employee_id
    and te.kind = 'work'
    and te.work_date >= v_ot_start
    and te.work_date <= v_end
  order by te.work_date, wc.code;
end $$;

/*
 * Time-off lines for a printed card. Period only - prior-period time
 * off is not shown, since it does not affect this period's overtime.
 */
create or replace function print_time_off_lines(p_timecard_id uuid)
returns table (
  work_date   date,
  code        text,
  description text,
  bucket      export_bucket,
  hours       numeric
)
language sql stable security definer set search_path = public as $$
  select
    te.work_date,
    toc.code,
    upper(toc.description),
    toc.bucket,
    te.hours
  from timecard_entries te
  join time_off_codes toc on toc.id = te.time_off_code_id
  where te.timecard_id = p_timecard_id
    and te.kind = 'time_off'
    and te.hours > 0
  order by te.work_date, toc.sort_order
$$;

/*
 * Workweek summary block for a printed card.
 *
 * One row per Sunday-Saturday week touching the overtime period, with
 * total, regular, and overtime hours. The first week may extend before
 * the pay period start; its totals include the prior-period days,
 * which is the whole reason they are shown.
 */
create or replace function print_week_summary(p_timecard_id uuid)
returns table (
  week_start   date,
  week_end     date,
  total_hours  numeric,
  regular      numeric,
  overtime     numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_start       date;
  v_end         date;
begin
  select tc.employee_id, pp.start_date, pp.end_date
    into v_employee_id, v_start, v_end
  from timecards tc
  join pay_periods pp on pp.id = tc.pay_period_id
  where tc.id = p_timecard_id;

  return query
  with weeks as (
    select distinct week_start(te.work_date) as wk
    from timecard_entries te
    join timecards tc2 on tc2.id = te.timecard_id
    left join time_off_codes toc on toc.id = te.time_off_code_id
    where tc2.employee_id = v_employee_id
      and te.work_date >= week_start(v_start)
      and te.work_date <= v_end
      and not te.unpaid
      and (te.kind = 'work' or coalesce(toc.counts_toward_ot, false))
  ),
  totals as (
    select
      weeks.wk,
      -- the full week, including days outside this pay period
      employee_week_total(v_employee_id, weeks.wk) as full_week,
      -- hours falling inside the printed range
      coalesce((
        select sum(te.hours)
        from timecard_entries te
        join timecards tc3 on tc3.id = te.timecard_id
        left join time_off_codes toc on toc.id = te.time_off_code_id
        where tc3.employee_id = v_employee_id
          and week_start(te.work_date) = weeks.wk
          and te.work_date <= v_end
          and not te.unpaid
          and (te.kind = 'work' or coalesce(toc.counts_toward_ot, false))
      ), 0) as shown
    from weeks
  )
  select
    totals.wk,
    totals.wk + 6,
    totals.shown,
    least(totals.shown, 40),
    greatest(totals.shown - 40, 0)
  from totals
  order by totals.wk;
end $$;

/*
 * Everything the printed header needs.
 */
create or replace function print_header(p_timecard_id uuid)
returns table (
  employee_number  text,
  employee_name    text,
  employee_type    employee_type,
  is_salaried      boolean,
  period_start     date,
  period_end       date,
  ot_start         date,
  ot_end           date,
  status           timecard_status,
  employee_approved_name text,
  employee_approved_at   timestamptz,
  supervisor_approved_name text,
  supervisor_approved_at   timestamptz,
  default_work_code text,
  default_work_desc text
)
language sql stable security definer set search_path = public as $$
  select
    e.employee_number,
    upper(e.first_name || ' ' || e.last_name),
    a.employee_type,
    a.employee_type = 'salaried',
    pp.start_date,
    pp.end_date,
    week_start(pp.start_date),
    pp.end_date,
    tc.status,
    upper(ea.first_name || ' ' || ea.last_name),
    tc.employee_approved_at,
    upper(sa.first_name || ' ' || sa.last_name),
    tc.supervisor_approved_at,
    wc.code,
    wc.description
  from timecards tc
  join employees e on e.id = tc.employee_id
  join pay_periods pp on pp.id = tc.pay_period_id
  join lateral (select * from assignment_on(tc.employee_id, pp.end_date)) a on true
  left join work_codes wc on wc.id = a.default_work_code_id
  left join employees ea on ea.id = tc.employee_approved_by
  left join employees sa on sa.id = tc.supervisor_approved_by
  where tc.id = p_timecard_id
$$;

/*
 * Distinct work codes used in the period, for the header listing.
 */
create or replace function print_codes_used(p_timecard_id uuid)
returns table (code text, description text)
language sql stable security definer set search_path = public as $$
  select distinct wc.code, wc.description
  from timecard_entries te
  join work_codes wc on wc.id = te.work_code_id
  where te.timecard_id = p_timecard_id
    and te.kind = 'work'
  order by wc.code
$$;

/*
 * Timecards to print for a period, in the order they should appear.
 * Supervisors get their own reports; payroll admins get everyone.
 */
create or replace function print_queue(
  p_pay_period_id uuid,
  p_only_approved boolean default false
)
returns table (
  timecard_id     uuid,
  employee_id     uuid,
  employee_number text,
  last_name       text,
  first_name      text,
  status          timecard_status
)
language sql stable security definer set search_path = public as $$
  select
    tc.id, e.id, e.employee_number, e.last_name, e.first_name, tc.status
  from timecards tc
  join employees e on e.id = tc.employee_id
  where tc.pay_period_id = p_pay_period_id
    and (not p_only_approved
         or tc.status in ('supervisor_approved', 'exported'))
    and (
      is_payroll_admin()
      or exists (
        select 1 from supervisor_assignments sa
        where sa.employee_id = tc.employee_id
          and sa.supervisor_id = current_employee_id()
      )
      or tc.employee_id = current_employee_id()
    )
  order by e.last_name, e.first_name
$$;
