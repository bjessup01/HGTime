-- ============================================================
-- Phase 5i: printed week summary corrections
-- ============================================================

/*
 * The workweek block on a printed card was recomputing its own
 * regular/overtime split, which could disagree with what the timecard
 * screen shows and with what actually settles.
 *
 * Two problems it had:
 *
 *   1. It capped hours at the period end, so a week extending past the
 *      period showed a partial total and claimed overtime that has not
 *      settled yet. A week ending 6/27 on a card ending 6/25 would show
 *      42 hours and 2 hours OT, even though the employee might work two
 *      more days and the whole week settles on the NEXT card.
 *
 *   2. It split at 40 within the displayed hours rather than using the
 *      settlement, which accounts for what other periods already paid
 *      for the same week.
 *
 * Both are already solved by timecard_ot_preview, which the timecard
 * screen uses. Reading from the same source keeps screen and paper in
 * agreement.
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
    -- the full week across every period; this is what establishes the
    -- 40-hour line and what the asterisked rows are there to show
    p.week_total,
    p.this_regular,
    p.this_ot,
    p.settles_here
  from timecard_ot_preview(p_timecard_id) p
  order by p.week_start
$$;
