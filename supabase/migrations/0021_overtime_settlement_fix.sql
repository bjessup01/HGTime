-- ============================================================
-- Phase 5j: overtime settlement fix
--
-- A pay period was settling the FULL Sunday-Saturday week, including
-- days belonging to other periods. A card ending mid-week therefore
-- paid days that had not been worked yet, and the next card found
-- nothing owed.
--
-- Concretely, the week of 6/21 split across two cards:
--
--     6/22-6/25   42.00   on the 6/11-6/25 card
--     6/26         4.00   on the 6/26-7/10 card
--     full week   46.00
--
--   Before: card 1 settled 40 regular + 6 OT (claiming 6/26 in advance),
--           card 2 settled nothing.
--   After:  card 1 settles 40 regular + 2 OT,
--           card 2 settles 0 regular + 4 OT.
--
-- The 40-hour line is still established by the full week across every
-- period, and by what other periods already settled - that part was
-- correct. What changes is how much THIS period may claim.
-- ============================================================

/*
 * Hours in a workweek that fall inside a given pay period.
 *
 * This is what a period may settle. Hours in the same week but in an
 * adjacent period belong to that period's card.
 */
create or replace function week_hours_in_period(
  p_employee_id   uuid,
  p_week_start    date,
  p_pay_period_id uuid
)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(te.hours), 0)
  from timecard_entries te
  join timecards tc on tc.id = te.timecard_id
  join pay_periods pp on pp.id = tc.pay_period_id
  left join time_off_codes toc on toc.id = te.time_off_code_id
  where tc.employee_id = p_employee_id
    and pp.id = p_pay_period_id
    and week_start(te.work_date) = p_week_start
    and te.work_date between pp.start_date and pp.end_date
    and not te.unpaid
    and (te.kind = 'work' or coalesce(toc.counts_toward_ot, false))
$$;

/*
 * Settle overtime for a timecard.
 *
 * For each workweek touched by this card:
 *   owed   = hours in this week that fall inside this period
 *   room   = 40 less regular hours other periods already settled
 *   regular = min(owed, room)
 *   ot      = owed - regular
 *
 * A week can therefore pay regular on one card and overtime on the
 * next, which is the point of settling in arrears.
 */
create or replace function settle_overtime(p_timecard_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id   uuid;
  v_period_id     uuid;
  r               record;
  v_owed          numeric;
  v_prior_regular numeric;
  v_prior_ot      numeric;
  v_regular_room  numeric;
  v_regular       numeric;
  v_ot            numeric;
  v_threshold     numeric := 40;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  for r in select * from timecard_week_hours(p_timecard_id) loop
    -- only hours inside this period may be settled here
    v_owed := week_hours_in_period(v_employee_id, r.week_start, v_period_id);

    -- what other periods already settled for this same week
    select
      coalesce(sum(regular_hours), 0),
      coalesce(sum(ot_hours), 0)
    into v_prior_regular, v_prior_ot
    from workweek_ledger
    where employee_id = v_employee_id
      and week_start = r.week_start
      and pay_period_id <> v_period_id;

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
 * Preview, matching the settlement exactly.
 *
 * week_total remains the full week across every period - that is what
 * establishes the 40-hour line and what the asterisked rows on a
 * printed card are showing. in_period is what this card may claim.
 */
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
    -- the week extends beyond this period in either direction
    split.wk < v_start or split.wk + 6 > v_end,
    -- the week ends inside this period, so nothing more will be added
    split.wk + 6 <= v_end
  from split
  order by split.wk;
end $$;

/*
 * Printed week summary follows the preview.
 */
drop function if exists print_week_summary(uuid);

create or replace function print_week_summary(p_timecard_id uuid)
returns table (
  week_start    date,
  week_end      date,
  total_hours   numeric,
  regular       numeric,
  overtime      numeric,
  settles_here  boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.week_start,
    p.week_start + 6,
    p.week_total,
    p.this_regular,
    p.this_ot,
    p.settles_here
  from timecard_ot_preview(p_timecard_id) p
  order by p.week_start
$$;

-- ------------------------------------------------------------
-- Re-settle already-approved cards
--
-- Cards approved under the old logic hold wrong ledger rows. Clearing
-- and re-settling in date order rebuilds them, since each period reads
-- what earlier periods settled.
-- ------------------------------------------------------------

create or replace function resettle_all_overtime()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v_count int := 0;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may re-settle overtime';
  end if;

  delete from workweek_ledger;

  for r in
    select tc.id
    from timecards tc
    join pay_periods pp on pp.id = tc.pay_period_id
    where tc.status in ('supervisor_approved', 'exported')
    order by pp.start_date, tc.id
  loop
    perform settle_overtime(r.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
