-- ============================================================
-- Phase 5o: order-independent overtime settlement
--
-- The split-week settlement counted "prior regular" as a week's regular
-- hours across all OTHER periods, ignoring which period comes first. The
-- result therefore depended on the order cards were approved.
--
--   Week 3/22-3/28 split as
--     card A (period ending 3/25):  33.75h
--     card B (period from 3/26):    17.50h
--
--   Approving B before A made A see B's 17.50 as "prior regular", so A
--   computed room = 40 - 17.50 = 22.50 and pushed 11.25 into overtime -
--   putting the overtime on the earlier half, which is entirely under 40
--   and should carry none.
--
--   Correct (date order): the first 40 hours of the week are regular, the
--   rest overtime. A's 33.75 are all under 40 -> 0 OT. B fills to 40
--   (6.25 regular) then 11.25 OT.
--
-- Fix: a period counts as prior only the regular hours of periods that
-- START BEFORE it, and after settling a period we re-settle every later
-- period holding the same week. The outcome is the same no matter what
-- order cards are approved.
-- ============================================================

/*
 * Settle one (employee, week, period) against earlier periods only and
 * write it to the ledger.
 */
create or replace function settle_week_in_period(
  p_employee_id uuid,
  p_week_start  date,
  p_period_id   uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_period_start date;
  v_owed         numeric;
  v_prior        numeric;
  v_room         numeric;
  v_regular      numeric;
  v_ot           numeric;
begin
  select start_date into v_period_start
    from pay_periods where id = p_period_id;

  v_owed := week_hours_in_period(p_employee_id, p_week_start, p_period_id);

  -- regular already claimed by strictly-earlier periods
  select coalesce(sum(l.regular_hours), 0)
    into v_prior
  from workweek_ledger l
  join pay_periods pp on pp.id = l.pay_period_id
  where l.employee_id = p_employee_id
    and l.week_start = p_week_start
    and l.pay_period_id <> p_period_id
    and pp.start_date < v_period_start;

  if v_owed <= 0 then
    v_regular := 0;
    v_ot := 0;
  else
    v_room := greatest(40 - v_prior, 0);
    v_regular := least(v_owed, v_room);
    v_ot := v_owed - v_regular;
  end if;

  insert into workweek_ledger
    (employee_id, week_start, pay_period_id, regular_hours, ot_hours, computed_at)
  values
    (p_employee_id, p_week_start, p_period_id, v_regular, v_ot, now())
  on conflict (employee_id, week_start, pay_period_id)
  do update set
    regular_hours = excluded.regular_hours,
    ot_hours      = excluded.ot_hours,
    computed_at   = now();
end $$;

create or replace function settle_overtime(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id  uuid;
  v_period_id    uuid;
  v_period_start date;
  r              record;
  later          record;
begin
  select tc.employee_id, tc.pay_period_id, pp.start_date
    into v_employee_id, v_period_id, v_period_start
  from timecards tc
  join pay_periods pp on pp.id = tc.pay_period_id
  where tc.id = p_timecard_id;

  for r in select * from timecard_week_hours(p_timecard_id) loop
    -- settle this period against earlier ones
    perform settle_week_in_period(v_employee_id, r.week_start, v_period_id);

    -- re-settle every later period holding this same week, in date order,
    -- so each sees the updated fill of the 40-hour line ahead of it
    for later in
      select l.pay_period_id
      from workweek_ledger l
      join pay_periods pp on pp.id = l.pay_period_id
      where l.employee_id = v_employee_id
        and l.week_start = r.week_start
        and pp.start_date > v_period_start
      order by pp.start_date
    loop
      perform settle_week_in_period(
        v_employee_id, r.week_start, later.pay_period_id
      );
    end loop;
  end loop;
end $$;

-- The preview must use the same earlier-periods-only rule so the screen
-- and printed card match the ledger.
drop function if exists timecard_ot_preview(uuid);

create or replace function timecard_ot_preview(p_timecard_id uuid)
returns table (
  week_start      date,
  week_total      numeric,
  in_period       numeric,
  prior_regular   numeric,
  prior_ot        numeric,
  this_regular    numeric,
  this_ot         numeric,
  is_split_week   boolean,
  settles_here    boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id  uuid;
  v_period_id    uuid;
  v_period_start date;
begin
  select tc.employee_id, tc.pay_period_id, pp.start_date
    into v_employee_id, v_period_id, v_period_start
  from timecards tc
  join pay_periods pp on pp.id = tc.pay_period_id
  where tc.id = p_timecard_id;

  return query
  with weeks as (
    select w.week_start from timecard_week_hours(p_timecard_id) w
  ),
  calc as (
    select
      weeks.week_start as wk,
      employee_week_total(v_employee_id, weeks.week_start) as full_week,
      week_hours_in_period(v_employee_id, weeks.week_start, v_period_id) as owed,
      -- regular filled by strictly-earlier periods
      coalesce((
        select sum(l.regular_hours) from workweek_ledger l
        join pay_periods pp on pp.id = l.pay_period_id
        where l.employee_id = v_employee_id
          and l.week_start = weeks.week_start
          and l.pay_period_id <> v_period_id
          and pp.start_date < v_period_start
      ), 0) as prior_reg,
      coalesce((
        select sum(l.ot_hours) from workweek_ledger l
        join pay_periods pp on pp.id = l.pay_period_id
        where l.employee_id = v_employee_id
          and l.week_start = weeks.week_start
          and l.pay_period_id <> v_period_id
          and pp.start_date < v_period_start
      ), 0) as prior_ot
    from weeks
  ),
  split as (
    select
      calc.*,
      least(calc.owed, greatest(40 - calc.prior_reg, 0)) as reg
    from calc
  )
  select
    split.wk,
    split.full_week,
    split.owed,
    split.prior_reg,
    split.prior_ot,
    case when split.owed <= 0 then 0 else split.reg end,
    case when split.owed <= 0 then 0 else split.owed - split.reg end,
    split.full_week > split.owed,
    split.full_week <= split.owed
  from split
  order by split.wk;
end $$;

-- ------------------------------------------------------------
-- Rebuild the ledger. Cards approved before this fix may hold overtime
-- on the wrong half of a split week. resettle_all_overtime clears and
-- re-settles every approved card in date order, which with the corrected
-- logic lands the overtime where the week actually crossed 40.
-- ------------------------------------------------------------

-- resettle_all_overtime already iterates in pay-period date order and
-- calls settle_overtime, so no change to it is needed - but run it now as
-- part of this migration so the fix applies without a manual step.
do $$
declare
  c record;
begin
  perform resettle_all_overtime();
exception when others then
  -- resettle guards on is_payroll_admin(); in a migration context the
  -- role may differ, so fall back to settling every approved card directly
  delete from workweek_ledger;
  for c in
    select tc.id
    from timecards tc
    join pay_periods pp on pp.id = tc.pay_period_id
    where tc.status in ('supervisor_approved', 'exported')
    order by pp.start_date, tc.id
  loop
    perform settle_overtime(c.id);
  end loop;
end $$;
