-- ============================================================
-- Phase 4: overtime settlement and floating holiday ledger
-- ============================================================

/*
 * OT-eligible hours per workweek for one timecard.
 *
 * Worked hours plus any time-off code flagged counts_toward_ot
 * (Holiday only). Other time-off codes are paid but excluded from
 * the 40-hour threshold.
 */
create or replace function timecard_week_hours(p_timecard_id uuid)
returns table (
  week_start   date,
  ot_eligible  numeric,
  worked       numeric,
  other_paid   numeric
)
language sql stable security definer set search_path = public as $$
  select
    week_start(te.work_date),
    coalesce(sum(te.hours) filter (
      where te.kind = 'work'
         or (te.kind = 'time_off' and toc.counts_toward_ot)
    ), 0),
    coalesce(sum(te.hours) filter (where te.kind = 'work'), 0),
    coalesce(sum(te.hours) filter (
      where te.kind = 'time_off' and not coalesce(toc.counts_toward_ot, false)
    ), 0)
  from timecard_entries te
  left join time_off_codes toc on toc.id = te.time_off_code_id
  where te.timecard_id = p_timecard_id
    and not te.unpaid
  group by week_start(te.work_date)
$$;

/*
 * All OT-eligible hours for an employee in a workweek, across every
 * timecard that touches it. A week straddling a period boundary has
 * entries on two cards; both count toward the same 40-hour threshold.
 */
create or replace function employee_week_total(
  p_employee_id uuid,
  p_week_start  date
)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(te.hours), 0)
  from timecard_entries te
  join timecards tc on tc.id = te.timecard_id
  left join time_off_codes toc on toc.id = te.time_off_code_id
  where tc.employee_id = p_employee_id
    and week_start(te.work_date) = p_week_start
    and not te.unpaid
    and (te.kind = 'work' or coalesce(toc.counts_toward_ot, false))
$$;

/*
 * Settle overtime for a timecard.
 *
 * For each workweek the card touches:
 *   1. Total the week's OT-eligible hours across ALL periods
 *   2. Subtract what prior periods already paid (workweek_ledger)
 *   3. Split the remainder into regular vs OT at the 40-hour line
 *
 * This is what makes split-week arrears work: a week ending in the
 * next period settles its OT there, using the full week's total.
 *
 * Idempotent - recomputes this period's row rather than accumulating.
 */
create or replace function settle_overtime(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id   uuid;
  v_period_id     uuid;
  r               record;
  v_week_total    numeric;
  v_prior_regular numeric;
  v_prior_ot      numeric;
  v_owed          numeric;
  v_regular_room  numeric;
  v_regular       numeric;
  v_ot            numeric;
  v_threshold     numeric := 40;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  for r in select * from timecard_week_hours(p_timecard_id) loop
    -- full week across every period
    v_week_total := employee_week_total(v_employee_id, r.week_start);

    -- what other periods already settled for this same week
    select
      coalesce(sum(regular_hours), 0),
      coalesce(sum(ot_hours), 0)
    into v_prior_regular, v_prior_ot
    from workweek_ledger
    where employee_id = v_employee_id
      and week_start = r.week_start
      and pay_period_id <> v_period_id;

    v_owed := v_week_total - (v_prior_regular + v_prior_ot);

    if v_owed <= 0 then
      v_regular := 0;
      v_ot := 0;
    else
      v_regular_room := greatest(v_threshold - v_prior_regular, 0);
      v_regular := least(v_owed, v_regular_room);
      v_ot := v_owed - v_regular;
    end if;

    insert into workweek_ledger
      (employee_id, week_start, pay_period_id, regular_hours, ot_hours, computed_at)
    values
      (v_employee_id, r.week_start, v_period_id, v_regular, v_ot, now())
    on conflict (employee_id, week_start, pay_period_id)
    do update set
      regular_hours = excluded.regular_hours,
      ot_hours      = excluded.ot_hours,
      computed_at   = now();
  end loop;
end $$;

/*
 * Read-only OT preview for the UI. Shows the settlement without
 * writing to the ledger, so an open card can display projected OT.
 */
create or replace function timecard_ot_preview(p_timecard_id uuid)
returns table (
  week_start      date,
  week_total      numeric,
  prior_regular   numeric,
  prior_ot        numeric,
  this_regular    numeric,
  this_ot         numeric,
  is_split_week   boolean,
  settles_here    boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
  v_start       date;
  v_end         date;
begin
  select tc.employee_id, tc.pay_period_id, pp.start_date, pp.end_date
    into v_employee_id, v_period_id, v_start, v_end
  from timecards tc
  join pay_periods pp on pp.id = tc.pay_period_id
  where tc.id = p_timecard_id;

  return query
  with weeks as (
    select w.week_start from timecard_week_hours(p_timecard_id) w
  ),
  calc as (
    select
      weeks.week_start,
      employee_week_total(v_employee_id, weeks.week_start) as total,
      coalesce((
        select sum(wl.regular_hours) from workweek_ledger wl
        where wl.employee_id = v_employee_id
          and wl.week_start = weeks.week_start
          and wl.pay_period_id <> v_period_id
      ), 0) as prior_reg,
      coalesce((
        select sum(wl.ot_hours) from workweek_ledger wl
        where wl.employee_id = v_employee_id
          and wl.week_start = weeks.week_start
          and wl.pay_period_id <> v_period_id
      ), 0) as prior_ot
    from weeks
  )
  select
    calc.week_start,
    calc.total,
    calc.prior_reg,
    calc.prior_ot,
    least(
      greatest(calc.total - calc.prior_reg - calc.prior_ot, 0),
      greatest(40 - calc.prior_reg, 0)
    ),
    greatest(
      greatest(calc.total - calc.prior_reg - calc.prior_ot, 0)
        - greatest(40 - calc.prior_reg, 0),
      0
    ),
    -- the week extends outside this period
    calc.week_start < v_start or calc.week_start + 6 > v_end,
    -- the week ENDS inside this period, so OT settles here
    calc.week_start + 6 <= v_end
  from calc
  order by calc.week_start;
end $$;

-- ------------------------------------------------------------
-- Floating holiday ledger
-- ------------------------------------------------------------

/*
 * Post floating holidays earned on a timecard.
 *
 * Two sources:
 *   1. Hours worked on a holiday, where the employee is salaried
 *      (always FH) or hourly and elected floating_holiday
 *   2. A 4x10 Friday holiday that converted because the employee
 *      worked all four Mon-Thu days
 *
 * Idempotent: clears this card's prior postings and re-derives.
 * Called at supervisor approval, not before - an open card should
 * not move balances.
 */
create or replace function post_floating_holidays(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  r             record;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  -- clear prior postings from this card
  delete from floating_holiday_ledger
   where employee_id = v_employee_id
     and timecard_entry_id in (
       select id from timecard_entries where timecard_id = p_timecard_id
     );

  -- also clear conversion postings, which have no entry to hang from
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

  -- 1. hours worked on a holiday
  for r in
    select
      hs.work_date,
      hs.holiday_name,
      hs.worked_hours,
      hs.election,
      (select a.employee_type from assignment_on(v_employee_id, hs.work_date) a)
        as emp_type
    from holiday_work_summary(p_timecard_id) hs
    where hs.worked_hours > 0
  loop
    -- salaried always bank FH; hourly only when they elected it
    if r.emp_type = 'salaried' or r.election = 'floating_holiday' then
      insert into floating_holiday_ledger
        (employee_id, hours, work_date, reason, timecard_entry_id)
      values
        (v_employee_id, r.worked_hours, r.work_date,
         'Worked ' || r.holiday_name, null);
    end if;
  end loop;

  -- 2. 4x10 Friday-holiday conversion
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

/* Current floating holiday balance. */
create or replace function floating_holiday_balance(p_employee_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(hours), 0)
  from floating_holiday_ledger
  where employee_id = p_employee_id
$$;

-- ------------------------------------------------------------
-- Supervisor approval
-- ------------------------------------------------------------

/*
 * Approve a timecard as supervisor. Settles OT and posts floating
 * holidays as one transaction - if any step fails, nothing lands.
 */
create or replace function approve_timecard_as_supervisor(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id  uuid;
  v_approver_id  uuid;
  v_status       timecard_status;
begin
  v_approver_id := current_employee_id();

  select employee_id, status into v_employee_id, v_status
    from timecards where id = p_timecard_id;

  if v_employee_id is null then
    raise exception 'Timecard not found';
  end if;

  if v_status = 'exported' then
    raise exception 'This timecard has already been exported';
  end if;

  -- must be an assigned supervisor or a payroll admin
  if not (
    is_payroll_admin()
    or exists (
      select 1 from supervisor_assignments sa
      where sa.employee_id = v_employee_id
        and sa.supervisor_id = v_approver_id
    )
  ) then
    raise exception 'You are not a supervisor for this employee';
  end if;

  perform settle_overtime(p_timecard_id);
  perform post_floating_holidays(p_timecard_id);

  update timecards
     set status = 'supervisor_approved',
         supervisor_approved_at = now(),
         supervisor_approved_by = v_approver_id
   where id = p_timecard_id;
end $$;

/* Withdraw supervisor approval; reverses the ledger postings. */
create or replace function unapprove_timecard_as_supervisor(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  if not (
    is_payroll_admin()
    or exists (
      select 1 from supervisor_assignments sa
      where sa.employee_id = v_employee_id
        and sa.supervisor_id = current_employee_id()
    )
  ) then
    raise exception 'You are not a supervisor for this employee';
  end if;

  if (select status from timecards where id = p_timecard_id) = 'exported' then
    raise exception 'Exported timecards cannot be reopened';
  end if;

  delete from workweek_ledger
   where employee_id = v_employee_id and pay_period_id = v_period_id;

  delete from floating_holiday_ledger
   where employee_id = v_employee_id
     and (
       timecard_entry_id in (
         select id from timecard_entries where timecard_id = p_timecard_id
       )
       or (timecard_entry_id is null and work_date in (
         select s.work_date
         from timecards tc
         join timecard_days_scaffold(tc.employee_id, tc.pay_period_id) s on true
         where tc.id = p_timecard_id
       ))
     );

  update timecards
     set status = 'employee_approved',
         supervisor_approved_at = null,
         supervisor_approved_by = null
   where id = p_timecard_id;
end $$;

-- ------------------------------------------------------------
-- Supervisor queue
-- ------------------------------------------------------------

/* Timecards this supervisor can act on for a period. */
create or replace function supervisor_queue(p_pay_period_id uuid)
returns table (
  timecard_id     uuid,
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  status          timecard_status,
  worked_hours    numeric,
  time_off_hours  numeric,
  total_hours     numeric,
  ot_hours        numeric,
  warning_count   int
)
language sql stable security definer set search_path = public as $$
  select
    tc.id,
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    tc.status,
    coalesce((
      select sum(te.hours) from timecard_entries te
      where te.timecard_id = tc.id and te.kind = 'work'
    ), 0),
    coalesce((
      select sum(te.hours) from timecard_entries te
      where te.timecard_id = tc.id and te.kind = 'time_off'
    ), 0),
    coalesce((
      select sum(te.hours) from timecard_entries te
      where te.timecard_id = tc.id
    ), 0),
    coalesce((
      select sum(p.this_ot) from timecard_ot_preview(tc.id) p
    ), 0),
    (select count(*)::int from timecard_warnings(tc.id))
  from timecards tc
  join employees e on e.id = tc.employee_id
  where tc.pay_period_id = p_pay_period_id
    and (
      is_payroll_admin()
      or exists (
        select 1 from supervisor_assignments sa
        where sa.employee_id = tc.employee_id
          and sa.supervisor_id = current_employee_id()
      )
    )
  order by e.last_name, e.first_name
$$;
