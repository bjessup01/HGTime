-- ============================================================
-- Holiday + pay period generation
-- ============================================================

-- nth weekday of a month, e.g. 3rd Monday of January
create or replace function nth_weekday(p_year int, p_month int, p_dow int, p_n int)
returns date language plpgsql immutable as $$
declare d date; first_dow int; offset_days int;
begin
  d := make_date(p_year, p_month, 1);
  first_dow := extract(dow from d)::int;
  offset_days := ((p_dow - first_dow + 7) % 7) + (p_n - 1) * 7;
  return d + offset_days;
end $$;

-- last given weekday of a month, e.g. last Monday of May
create or replace function last_weekday(p_year int, p_month int, p_dow int)
returns date language plpgsql immutable as $$
declare d date; last_dow int;
begin
  d := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  last_dow := extract(dow from d)::int;
  return d - ((last_dow - p_dow + 7) % 7);
end $$;

-- Easter Sunday (Anonymous Gregorian algorithm) -> Good Friday is Easter - 2
create or replace function easter_sunday(p_year int)
returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int;
        h int; i int; k int; l int; m int; mth int; dy int;
begin
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451;
  mth := (h + l - 7*m + 114) / 31;
  dy  := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(p_year, mth, dy);
end $$;

-- Saturday -> observed previous Friday; Sunday -> observed following Monday
create or replace function observed_date(p_date date)
returns date language sql immutable as $$
  select case extract(dow from p_date)::int
           when 6 then p_date - 1   -- Saturday
           when 0 then p_date + 1   -- Sunday
           else p_date
         end
$$;

-- Generate the company's nine observed holidays for a year
create or replace function generate_holidays(p_year int)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('New Year''s Day',   make_date(p_year, 1, 1)),
      ('MLK Day',           nth_weekday(p_year, 1, 1, 3)),
      ('Presidents'' Day',  nth_weekday(p_year, 2, 1, 3)),
      ('Good Friday',       easter_sunday(p_year) - 2),
      ('Memorial Day',      last_weekday(p_year, 5, 1)),
      ('Independence Day',  make_date(p_year, 7, 4)),
      ('Labor Day',         nth_weekday(p_year, 9, 1, 1)),
      ('Thanksgiving',      nth_weekday(p_year, 11, 4, 4)),
      ('Christmas Day',     make_date(p_year, 12, 25))
    ) as h(name, actual)
  loop
    insert into holidays (name, actual_date, observed_date, year)
    values (rec.name, rec.actual, observed_date(rec.actual), p_year)
    on conflict (name, year) do update
      set actual_date = excluded.actual_date,
          observed_date = excluded.observed_date;
  end loop;
end $$;

-- ---------- pay periods ----------

-- Semi-monthly: 26th -> 10th, and 11th -> 25th. Periods straddle months.
create or replace function generate_semi_monthly_periods(p_year int)
returns void language plpgsql security definer set search_path = public as $$
declare m int; s date; e date;
begin
  for m in 1..12 loop
    -- 11th - 25th of this month
    s := make_date(p_year, m, 11);
    e := make_date(p_year, m, 25);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('semi_monthly', s, e)
    on conflict (payroll_type, start_date) do nothing;

    -- 26th of this month - 10th of next month
    s := make_date(p_year, m, 26);
    e := (s + interval '1 month')::date;
    e := make_date(extract(year from e)::int, extract(month from e)::int, 10);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('semi_monthly', s, e)
    on conflict (payroll_type, start_date) do nothing;
  end loop;
end $$;

-- Bi-weekly: no fixed anchor. Seasonal — caller supplies the first Sunday
-- and how many periods to generate.
create or replace function generate_bi_weekly_periods(p_start date, p_count int)
returns void language plpgsql security definer set search_path = public as $$
declare i int; s date;
begin
  if extract(dow from p_start)::int <> 0 then
    raise exception 'Bi-weekly periods must start on a Sunday (got %)', p_start;
  end if;

  for i in 0..(p_count - 1) loop
    s := p_start + (i * 14);
    insert into pay_periods (payroll_type, start_date, end_date)
    values ('bi_weekly', s, s + 13)
    on conflict (payroll_type, start_date) do nothing;
  end loop;
end $$;

-- Sunday of the workweek containing a date
create or replace function week_start(p_date date)
returns date language sql immutable as $$
  select p_date - extract(dow from p_date)::int
$$;

-- ---------- seed calendars ----------

select generate_holidays(2026);
select generate_holidays(2027);
select generate_semi_monthly_periods(2026);
select generate_semi_monthly_periods(2027);

-- 2026 bi-weekly season, anchored to the first period you ran (5/3/26)
select generate_bi_weekly_periods('2026-05-03', 14);
