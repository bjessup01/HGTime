-- ============================================================
-- Phase 5n: overtime, shuttle, and missing-timecard reports
-- ============================================================

-- ------------------------------------------------------------
-- Overtime report
--
-- One row per employee per week that carries settled overtime. Settled
-- means the hours come from the workweek_ledger, which is only written
-- when a card is supervisor-approved. Weeks on open cards are not here -
-- their overtime is not final until the settling period is approved.
-- ------------------------------------------------------------

create or replace function overtime_report(
  p_from date,
  p_to   date
)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  week_start      date,
  week_end        date,
  regular_hours   numeric,
  ot_hours        numeric,
  period_start    date,
  period_end      date,
  is_split        boolean
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    l.week_start,
    l.week_start + 6,
    l.regular_hours,
    l.ot_hours,
    pp.start_date,
    pp.end_date,
    -- the same week appears for more than one period = it was split
    (select count(*) > 1
       from workweek_ledger l2
      where l2.employee_id = l.employee_id
        and l2.week_start = l.week_start)
  from workweek_ledger l
  join employees e on e.id = l.employee_id
  join pay_periods pp on pp.id = l.pay_period_id
  join timecards tc
    on tc.employee_id = l.employee_id
   and tc.pay_period_id = l.pay_period_id
  where is_payroll_admin()
    and tc.status in ('supervisor_approved', 'exported')
    and l.ot_hours > 0
    and l.week_start between p_from and p_to
  order by e.last_name, e.first_name, l.week_start, pp.start_date
$$;

create or replace function overtime_report_totals(
  p_from date,
  p_to   date
)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  ot_hours        numeric
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    sum(l.ot_hours)
  from workweek_ledger l
  join employees e on e.id = l.employee_id
  join timecards tc
    on tc.employee_id = l.employee_id
   and tc.pay_period_id = l.pay_period_id
  where is_payroll_admin()
    and tc.status in ('supervisor_approved', 'exported')
    and l.ot_hours > 0
    and l.week_start between p_from and p_to
  group by e.id, e.employee_number, e.first_name, e.last_name
  order by e.last_name, e.first_name
$$;

-- ------------------------------------------------------------
-- Shuttle incentive report
--
-- One row per employee per day an incentive was recorded, with the
-- level and its dollar value.
-- ------------------------------------------------------------

create or replace function shuttle_report(
  p_from date,
  p_to   date
)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  work_date       date,
  label           text,
  amount          numeric
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    td.work_date,
    sil.label,
    sil.amount
  from timecard_days td
  join timecards tc on tc.id = td.timecard_id
  join employees e on e.id = tc.employee_id
  join shuttle_incentive_levels sil on sil.id = td.shuttle_level_id
  where is_payroll_admin()
    and td.shuttle_level_id is not null
    and td.work_date between p_from and p_to
  order by e.last_name, e.first_name, td.work_date
$$;

create or replace function shuttle_report_totals(
  p_from date,
  p_to   date
)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  day_count       int,
  total_amount    numeric
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    count(*)::int,
    sum(sil.amount)
  from timecard_days td
  join timecards tc on tc.id = td.timecard_id
  join employees e on e.id = tc.employee_id
  join shuttle_incentive_levels sil on sil.id = td.shuttle_level_id
  where is_payroll_admin()
    and td.shuttle_level_id is not null
    and td.work_date between p_from and p_to
  group by e.id, e.employee_number, e.first_name, e.last_name
  order by e.last_name, e.first_name
$$;

-- ------------------------------------------------------------
-- Missing timecard report
--
-- For a pay period: everyone who should have an approved card but does
-- not. Two states are "missing":
--   - no card exists for the period
--   - a card exists but is not supervisor-approved
--
-- Only employees employed at any point in the period are considered.
-- ------------------------------------------------------------

create or replace function missing_timecard_report(p_pay_period_id uuid)
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  employee_type   employee_type,
  card_status     text,
  entry_count     int
)
language sql stable security definer set search_path = public as $$
  with period as (
    select start_date, end_date, payroll_type
    from pay_periods where id = p_pay_period_id
  )
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    a.employee_type,
    coalesce(tc.status::text, 'no card'),
    coalesce((
      select count(*)::int from timecard_entries te
      where te.timecard_id = tc.id
    ), 0)
  from employees e
  join period p on true
  join lateral (select * from assignment_on(e.id, p.end_date)) a on true
  left join timecards tc
    on tc.employee_id = e.id and tc.pay_period_id = p_pay_period_id
  where is_payroll_admin()
    -- employed at some point during the period
    and exists (
      select 1 from employment_periods ep
      where ep.employee_id = e.id
        and ep.hire_date <= p.end_date
        and (ep.term_date is null or ep.term_date >= p.start_date)
    )
    -- on this payroll
    and a.payroll_type = p.payroll_type
    -- not yet finished: no card, or a card short of supervisor approval
    and (tc.id is null or tc.status in ('open', 'employee_approved'))
  order by
    (tc.id is null) desc,   -- no-card first
    e.last_name, e.first_name
$$;
