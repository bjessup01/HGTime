-- ============================================================
-- Phase 5k: printed week block corrections
--
-- Overtime is paid in the period where the hours were WORKED. The
-- settlement in 0021 does that correctly; this fixes the display.
--
-- Two problems:
--
--   1. The Total column showed the full Sunday-Saturday week across
--      every period. On a card ending 6/25 the week of 6/21 printed
--      46.00, which includes 4 hours worked on 6/26 and paid on the
--      next card. The block is a settlement table, so it must show
--      what THIS card pays.
--
--   2. settles_here tested whether the week ended inside the period.
--      That is the wrong question - a week extending past the period
--      says nothing about where its hours are paid. The 2 hours of
--      overtime earned on 6/25 are paid on the 6/11-6/25 card even
--      though that week runs to 6/27.
--
--      The useful signal is whether part of the week is paid on a
--      different card, which is true when the full week exceeds what
--      this period holds.
-- ============================================================

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
  v_employee_id uuid;
  v_period_id   uuid;
begin
  select tc.employee_id, tc.pay_period_id
    into v_employee_id, v_period_id
  from timecards tc
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
      coalesce((
        select sum(l.regular_hours) from workweek_ledger l
        where l.employee_id = v_employee_id
          and l.week_start = weeks.week_start
          and l.pay_period_id <> v_period_id
      ), 0) as prior_reg,
      coalesce((
        select sum(l.ot_hours) from workweek_ledger l
        where l.employee_id = v_employee_id
          and l.week_start = weeks.week_start
          and l.pay_period_id <> v_period_id
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
    -- part of this week is paid on another card
    split.full_week > split.owed,
    -- this card settles every hour of the week
    split.full_week <= split.owed
  from split
  order by split.wk;
end $$;

/*
 * Printed week block shows what this card pays.
 *
 * total_hours is the hours inside this period, not the full week -
 * the block is a settlement table and the columns must add up.
 * full_week is carried separately so the card can note when part of a
 * week is paid elsewhere.
 */
drop function if exists print_week_summary(uuid);

create or replace function print_week_summary(p_timecard_id uuid)
returns table (
  week_start    date,
  week_end      date,
  total_hours   numeric,
  regular       numeric,
  overtime      numeric,
  full_week     numeric,
  is_split      boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.week_start,
    p.week_start + 6,
    p.in_period,
    p.this_regular,
    p.this_ot,
    p.week_total,
    p.is_split_week
  from timecard_ot_preview(p_timecard_id) p
  order by p.week_start
$$;
