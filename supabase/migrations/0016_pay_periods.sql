-- ============================================================
-- Phase 5e: pay period management
-- ============================================================

/*
 * Pay periods with usage information, so the admin screen can show
 * what exists and block deleting anything in use.
 */
create or replace function pay_period_list(
  p_payroll_type payroll_type,
  p_from         date default null,
  p_to           date default null
)
returns table (
  id             uuid,
  payroll_type   payroll_type,
  start_date     date,
  end_date       date,
  locked_at      timestamptz,
  exported_at    timestamptz,
  timecard_count int,
  entry_count    int,
  can_delete     boolean,
  is_current     boolean,
  is_future      boolean
)
language sql stable security definer set search_path = public as $$
  select
    pp.id,
    pp.payroll_type,
    pp.start_date,
    pp.end_date,
    pp.locked_at,
    pp.exported_at,
    coalesce(tc.cards, 0)::int,
    coalesce(tc.entries, 0)::int,
    -- a period with any timecard is never deletable
    coalesce(tc.cards, 0) = 0 and pp.exported_at is null,
    current_date between pp.start_date and pp.end_date,
    pp.start_date > current_date
  from pay_periods pp
  left join lateral (
    select
      count(distinct t.id) as cards,
      count(e.id) as entries
    from timecards t
    left join timecard_entries e on e.timecard_id = t.id
    where t.pay_period_id = pp.id
  ) tc on true
  where pp.payroll_type = p_payroll_type
    and (p_from is null or pp.end_date >= p_from)
    and (p_to is null or pp.start_date <= p_to)
  order by pp.start_date desc
$$;

/*
 * Generate a calendar year of semi-monthly periods.
 *
 * Dates are fixed - 11th through 25th, and 26th through the 10th of
 * the following month - so a whole year can be created at once.
 * Returns how many were actually new.
 */
create or replace function generate_semi_monthly_year(p_year int)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m       int;
  s       date;
  e       date;
  v_count int := 0;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may generate pay periods';
  end if;

  if p_year < 2000 or p_year > 2100 then
    raise exception 'Year % is out of range', p_year;
  end if;

  for m in 1..12 loop
    -- 11th through 25th
    s := make_date(p_year, m, 11);
    e := make_date(p_year, m, 25);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('semi_monthly', s, e)
    on conflict (payroll_type, start_date) do nothing;
    if found then v_count := v_count + 1; end if;

    -- 26th through the 10th of the next month
    s := make_date(p_year, m, 26);
    e := (s + interval '1 month')::date;
    e := make_date(extract(year from e)::int, extract(month from e)::int, 10);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('semi_monthly', s, e)
    on conflict (payroll_type, start_date) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end $$;

/*
 * Generate a bi-weekly season.
 *
 * Bi-weekly has no fixed anchor - the season starts when the first
 * bi-weekly employee starts, which varies year to year, and some
 * years may not run bi-weekly at all. So the caller supplies the
 * start date and how many periods to create.
 *
 * Periods must start on a Sunday; the guard is deliberate, since an
 * off-by-one anchor would misalign every overtime week for the season.
 */
create or replace function generate_bi_weekly_season(
  p_start date,
  p_count int
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  i       int;
  s       date;
  v_count int := 0;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may generate pay periods';
  end if;

  if extract(dow from p_start)::int <> 0 then
    raise exception 'Bi-weekly periods must start on a Sunday (% is a %)',
      p_start, to_char(p_start, 'Day');
  end if;

  if p_count < 1 or p_count > 40 then
    raise exception 'Count must be between 1 and 40';
  end if;

  for i in 0..(p_count - 1) loop
    s := p_start + (i * 14);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('bi_weekly', s, s + 13)
    on conflict (payroll_type, start_date) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end $$;

/*
 * Delete a pay period. Blocked once any timecard exists for it -
 * removing a period would orphan real recorded time.
 */
create or replace function delete_pay_period(p_pay_period_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cards int;
  v_exported timestamptz;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may delete pay periods';
  end if;

  select count(*) into v_cards from timecards where pay_period_id = p_pay_period_id;
  select exported_at into v_exported from pay_periods where id = p_pay_period_id;

  if v_cards > 0 then
    raise exception
      'This period has % timecard(s) and cannot be deleted', v_cards;
  end if;

  if v_exported is not null then
    raise exception 'Exported periods cannot be deleted';
  end if;

  delete from pay_periods where id = p_pay_period_id;
end $$;

/*
 * What years already have semi-monthly periods, so the screen can
 * offer the next one rather than making the admin guess.
 */
create or replace function semi_monthly_coverage()
returns table (year int, period_count int, complete boolean)
language sql stable security definer set search_path = public as $$
  select
    extract(year from pp.start_date)::int,
    count(*)::int,
    count(*) = 24
  from pay_periods pp
  where pp.payroll_type = 'semi_monthly'
  group by extract(year from pp.start_date)
  order by 1 desc
$$;

/*
 * Bi-weekly seasons, grouped by contiguous runs of 14-day periods.
 * A gap larger than 14 days starts a new season.
 */
create or replace function bi_weekly_seasons()
returns table (
  season_start date,
  season_end   date,
  period_count int
)
language sql stable security definer set search_path = public as $$
  with ordered as (
    select
      pp.start_date,
      pp.end_date,
      lag(pp.end_date) over (order by pp.start_date) as prev_end
    from pay_periods pp
    where pp.payroll_type = 'bi_weekly'
  ),
  marked as (
    select
      start_date,
      end_date,
      sum(case
            when prev_end is null or start_date > prev_end + 1 then 1
            else 0
          end) over (order by start_date) as season
    from ordered
  )
  select
    min(start_date),
    max(end_date),
    count(*)::int
  from marked
  group by season
  order by 1 desc
$$;
