-- ============================================================
-- Phase 5g: accrual rates
--
-- The payroll system remains the source of truth for both balances
-- and accrual rates. Rates are entered here manually, copied from
-- payroll, so this app never computes a tier and never disagrees
-- with payroll about what someone earns.
--
-- Rates are used for two things only:
--   1. Capping what an employee may enter (balance + accrual earned)
--   2. Projecting the 3/31 balance for the year-end conversion
--
-- Neither writes an accrued balance as truth. The next import
-- corrects any drift.
-- ============================================================

create table if not exists accrual_rates (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references employees(id) on delete cascade,
  effective_from    date not null,
  vacation_per_period numeric(6,2) not null default 0,
  sick_per_period     numeric(6,2) not null default 0,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid references employees(id),
  unique (employee_id, effective_from)
);

create index if not exists accrual_rates_employee_idx
  on accrual_rates (employee_id, effective_from desc);

alter table accrual_rates enable row level security;

drop policy if exists accrual_rates_read on accrual_rates;
create policy accrual_rates_read on accrual_rates for select to authenticated
  using (can_view_employee(employee_id));

drop policy if exists accrual_rates_write on accrual_rates;
create policy accrual_rates_write on accrual_rates for all to authenticated
  using (is_payroll_admin()) with check (is_payroll_admin());

/*
 * The rate in effect on a given date.
 *
 * Returns zeros when no rate has been entered, which means no accrual
 * is assumed - the cap falls back to the imported balance alone. That
 * is the safe direction to be wrong in.
 */
create or replace function accrual_rate_on(
  p_employee_id uuid,
  p_date        date
)
returns table (vacation_per_period numeric, sick_per_period numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce(ar.vacation_per_period, 0),
    coalesce(ar.sick_per_period, 0)
  from (select 1) dummy
  left join lateral (
    select * from accrual_rates
    where employee_id = p_employee_id
      and effective_from <= p_date
    order by effective_from desc
    limit 1
  ) ar on true
$$;

/*
 * Accrual earned between two dates, walking pay periods.
 *
 * A period's accrual counts once the period has STARTED. Payroll
 * credits it when the period is processed, so an employee working
 * through the current period has earned it but payroll has not yet
 * recorded it - which is exactly the gap this closes.
 *
 * The rate is looked up per period, so a rate change part way through
 * the window is applied from the period it takes effect.
 */
create or replace function accrual_between(
  p_employee_id uuid,
  p_bank        balance_bank,
  p_from        date,
  p_to          date
)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_payroll payroll_type;
  v_total   numeric := 0;
  r         record;
  v_rate    numeric;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return 0;
  end if;

  select a.payroll_type into v_payroll
    from assignment_on(p_employee_id, p_from) a;

  if v_payroll is null then
    return 0;
  end if;

  for r in
    select pp.start_date
    from pay_periods pp
    where pp.payroll_type = v_payroll
      and pp.start_date >= p_from
      and pp.start_date <= p_to
    order by pp.start_date
  loop
    select case
             when p_bank = 'vacation' then ar.vacation_per_period
             else ar.sick_per_period
           end
      into v_rate
    from accrual_rate_on(p_employee_id, r.start_date) ar;

    -- only accrue while employed
    if employed_on(p_employee_id, r.start_date) then
      v_total := v_total + coalesce(v_rate, 0);
    end if;
  end loop;

  return round(v_total, 2);
end $$;

/*
 * What an employee may actually use right now.
 *
 * The imported balance, plus accrual for every period that has started
 * since the snapshot, less time off already entered against it.
 *
 * p_exclude_entry lets an edit ignore its own current value so editing
 * an existing entry does not count itself twice.
 */
create or replace function available_balance(
  p_employee_id   uuid,
  p_bank          balance_bank,
  p_exclude_entry uuid default null
)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_snapshot   numeric;
  v_snap_date  date;
  v_accrued    numeric;
  v_used       numeric;
begin
  v_snapshot  := current_balance(p_employee_id, p_bank);
  v_snap_date := current_balance_date(p_employee_id, p_bank);

  if v_snap_date is null then
    return 0;
  end if;

  -- periods starting on or after the snapshot date, including the one
  -- the snapshot falls in: payroll credits at processing, so that
  -- period's accrual is earned but not yet in the imported figure
  v_accrued := accrual_between(p_employee_id, p_bank, v_snap_date, current_date);

  select coalesce(sum(te.hours), 0) into v_used
  from timecard_entries te
  join timecards tc on tc.id = te.timecard_id
  join time_off_codes toc on toc.id = te.time_off_code_id
  where tc.employee_id = p_employee_id
    and toc.bank = p_bank
    and te.kind = 'time_off'
    and not te.unpaid
    and te.work_date > v_snap_date
    and (p_exclude_entry is null or te.id <> p_exclude_entry);

  return round(greatest(v_snapshot + v_accrued - v_used, 0), 2);
end $$;

-- ------------------------------------------------------------
-- Cap enforcement
-- ------------------------------------------------------------

/*
 * Extend the daily-cap trigger to enforce bank limits.
 *
 * Vacation and sick draw on banks that cannot go negative. The limit
 * is the imported balance plus accrual earned since - so an employee
 * can spend what they have earned this period even though payroll has
 * not credited it yet.
 */
create or replace function check_daily_hour_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total       numeric;
  v_employee_id uuid;
  v_is_float    boolean;
  v_bank        balance_bank;
  v_available   numeric;
  v_code        text;
begin
  select coalesce(sum(te.hours), 0) into v_total
  from timecard_entries te
  where te.timecard_id = new.timecard_id
    and te.work_date = new.work_date
    and te.id <> new.id;

  if v_total + new.hours > 24 then
    raise exception
      'A day cannot exceed 24 hours (this would make %)',
      to_char(v_total + new.hours, 'FM999990.00');
  end if;

  if new.time_off_code_id is null then
    return new;
  end if;

  select toc.is_floating_holiday, toc.bank, toc.code
    into v_is_float, v_bank, v_code
  from time_off_codes toc where toc.id = new.time_off_code_id;

  select tc.employee_id into v_employee_id
  from timecards tc where tc.id = new.timecard_id;

  -- floating holiday draws on the earned ledger, not an imported bank
  if coalesce(v_is_float, false) then
    v_available := floating_holiday_available(v_employee_id, new.id);

    if new.hours > v_available then
      raise exception
        'Only % floating holiday hours are available',
        to_char(v_available, 'FM999990.00');
    end if;

    return new;
  end if;

  -- vacation and sick draw on imported banks plus accrual
  if v_bank is not null and not new.unpaid then
    v_available := available_balance(v_employee_id, v_bank, new.id);

    if new.hours > v_available then
      raise exception
        'Only % % hours are available (balance plus accrual earned)',
        to_char(v_available, 'FM999990.00'), v_bank;
    end if;
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- Accrual-aware year-end projection
-- ------------------------------------------------------------

/*
 * Projection now answers the question employees actually ask:
 * "if I take no more time off, where do I land on 3/31?"
 *
 *   projected = snapshot
 *             - time off already entered since the snapshot
 *             + accrual for every period starting through 3/31
 */
create or replace function year_end_projection(
  p_employee_id uuid,
  p_fiscal_year int default null
)
returns table (
  fiscal_year_end     date,
  vacation_cap        numeric,
  sick_cap            numeric,
  snapshot_vacation   numeric,
  snapshot_sick       numeric,
  snapshot_date       date,
  pending_vacation    numeric,
  pending_sick        numeric,
  accrual_vacation    numeric,
  accrual_sick        numeric,
  projected_vacation  numeric,
  projected_sick      numeric,
  vacation_over       numeric,
  sick_room           numeric,
  vacation_to_sick    numeric,
  vacation_forfeited  numeric,
  sick_over           numeric,
  sick_to_vacation    numeric,
  sick_consumed       numeric,
  final_vacation      numeric,
  final_sick          numeric,
  vacation_to_use     numeric,
  has_accrual_rate    boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  cfg              year_end_config;
  v_year           int;
  v_fy_end         date;
  v_snap_vac       numeric;
  v_snap_sick      numeric;
  v_snap_vac_date  date;
  v_snap_sick_date date;
  v_pend_vac       numeric;
  v_pend_sick      numeric;
  v_acc_vac        numeric;
  v_acc_sick       numeric;
  v_proj_vac       numeric;
  v_proj_sick      numeric;
  v_vac_over       numeric;
  v_sick_room      numeric;
  v_vac_to_sick    numeric;
  v_vac_forfeit    numeric;
  v_sick_after     numeric;
  v_vac_after      numeric;
  v_sick_over      numeric;
  v_sick_to_vac    numeric;
  v_has_rate       boolean;
begin
  select * into cfg from year_end_config where active order by effective_from desc limit 1;
  if cfg is null then
    raise exception 'No active year_end_config row';
  end if;

  v_year := coalesce(
    p_fiscal_year,
    case
      when current_date <= make_date(
        extract(year from current_date)::int,
        cfg.fiscal_year_end_month, cfg.fiscal_year_end_day)
      then extract(year from current_date)::int
      else extract(year from current_date)::int + 1
    end
  );
  v_fy_end := make_date(v_year, cfg.fiscal_year_end_month, cfg.fiscal_year_end_day);

  v_snap_vac  := current_balance(p_employee_id, 'vacation');
  v_snap_sick := current_balance(p_employee_id, 'sick');
  v_snap_vac_date  := current_balance_date(p_employee_id, 'vacation');
  v_snap_sick_date := current_balance_date(p_employee_id, 'sick');

  v_pend_vac := time_off_since_snapshot(
    p_employee_id, 'vacation',
    coalesce(v_snap_vac_date, '1900-01-01'::date), v_fy_end);
  v_pend_sick := time_off_since_snapshot(
    p_employee_id, 'sick',
    coalesce(v_snap_sick_date, '1900-01-01'::date), v_fy_end);

  -- accrual from the snapshot forward to fiscal year end
  v_acc_vac := accrual_between(
    p_employee_id, 'vacation',
    coalesce(v_snap_vac_date, current_date), v_fy_end);
  v_acc_sick := accrual_between(
    p_employee_id, 'sick',
    coalesce(v_snap_sick_date, current_date), v_fy_end);

  select exists (
    select 1 from accrual_rates
    where employee_id = p_employee_id
      and (vacation_per_period > 0 or sick_per_period > 0)
  ) into v_has_rate;

  v_proj_vac  := greatest(v_snap_vac - v_pend_vac + v_acc_vac, 0);
  v_proj_sick := greatest(v_snap_sick - v_pend_sick + v_acc_sick, 0);

  -- Step 1: end of 3/31
  v_vac_over    := greatest(v_proj_vac - cfg.vacation_carryover_max, 0);
  v_sick_room   := greatest(cfg.sick_carryover_max - v_proj_sick, 0);
  v_vac_to_sick := least(v_vac_over * cfg.vacation_to_sick_ratio, v_sick_room);
  v_vac_forfeit := greatest(v_vac_over - v_vac_to_sick, 0);

  v_vac_after  := v_proj_vac - v_vac_over;
  v_sick_after := v_proj_sick + v_vac_to_sick;

  -- Step 2: 4/1
  v_sick_over   := greatest(v_sick_after - cfg.sick_carryover_max, 0);
  v_sick_to_vac := round(v_sick_over / cfg.sick_to_vacation_divisor, 2);

  return query select
    v_fy_end,
    cfg.vacation_carryover_max,
    cfg.sick_carryover_max,
    v_snap_vac,
    v_snap_sick,
    coalesce(v_snap_vac_date, v_snap_sick_date),
    v_pend_vac,
    v_pend_sick,
    v_acc_vac,
    v_acc_sick,
    v_proj_vac,
    v_proj_sick,
    v_vac_over,
    v_sick_room,
    v_vac_to_sick,
    v_vac_forfeit,
    v_sick_over,
    v_sick_to_vac,
    v_sick_over,
    round(v_vac_after + v_sick_to_vac, 2),
    round(v_sick_after - v_sick_over, 2),
    v_vac_over,
    coalesce(v_has_rate, false);
end $$;

-- ------------------------------------------------------------
-- Admin plumbing
-- ------------------------------------------------------------

create or replace function set_accrual_rate(
  p_employee_id uuid,
  p_effective   date,
  p_vacation    numeric,
  p_sick        numeric,
  p_note        text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may set accrual rates';
  end if;

  if p_vacation < 0 or p_sick < 0 then
    raise exception 'Accrual rates cannot be negative';
  end if;

  insert into accrual_rates
    (employee_id, effective_from, vacation_per_period, sick_per_period, note, created_by)
  values
    (p_employee_id, p_effective, p_vacation, p_sick, p_note, current_employee_id())
  on conflict (employee_id, effective_from)
  do update set
    vacation_per_period = excluded.vacation_per_period,
    sick_per_period     = excluded.sick_per_period,
    note                = excluded.note,
    created_by          = excluded.created_by
  returning id into v_id;

  return v_id;
end $$;

create or replace function delete_accrual_rate(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may delete accrual rates';
  end if;
  delete from accrual_rates where id = p_id;
end $$;

/*
 * Who has no accrual rate on file. Without one the cap falls back to
 * the imported balance alone, so this is worth surfacing.
 */
create or replace function employees_without_accrual()
returns table (
  employee_id     uuid,
  employee_number text,
  first_name      text,
  last_name       text,
  employee_type   employee_type
)
language sql stable security definer set search_path = public as $$
  select e.id, e.employee_number, e.first_name, e.last_name, a.employee_type
  from employees e
  join lateral (select * from assignment_on(e.id, current_date)) a on true
  where e.active
    and a.employee_type in ('salaried', 'full_time_hourly')
    and not exists (select 1 from accrual_rates ar where ar.employee_id = e.id)
  order by e.last_name, e.first_name
$$;

-- Dashboard needs the available figure, not just the snapshot.
create or replace function employee_dashboard(p_employee_id uuid)
returns table (
  vacation_balance      numeric,
  vacation_as_of        date,
  vacation_pending      numeric,
  vacation_available    numeric,
  sick_balance          numeric,
  sick_as_of            date,
  sick_pending          numeric,
  sick_available        numeric,
  floating_holiday      numeric,
  open_timecard_id      uuid,
  open_period_start     date,
  open_period_end       date,
  open_timecard_status  timecard_status,
  pending_warnings      int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_payroll  payroll_type;
  v_card_id  uuid;
  v_period   record;
begin
  select a.payroll_type into v_payroll
    from assignment_on(p_employee_id, current_date) a;

  select pp.* into v_period
    from pay_periods pp
   where pp.payroll_type = v_payroll
     and pp.start_date <= current_date
     and pp.end_date >= current_date
   limit 1;

  if v_period.id is not null then
    select tc.id into v_card_id from timecards tc
     where tc.employee_id = p_employee_id
       and tc.pay_period_id = v_period.id;
  end if;

  return query select
    current_balance(p_employee_id, 'vacation'),
    current_balance_date(p_employee_id, 'vacation'),
    time_off_since_snapshot(p_employee_id, 'vacation',
      coalesce(current_balance_date(p_employee_id, 'vacation'), '1900-01-01'::date), null),
    available_balance(p_employee_id, 'vacation'),
    current_balance(p_employee_id, 'sick'),
    current_balance_date(p_employee_id, 'sick'),
    time_off_since_snapshot(p_employee_id, 'sick',
      coalesce(current_balance_date(p_employee_id, 'sick'), '1900-01-01'::date), null),
    available_balance(p_employee_id, 'sick'),
    floating_holiday_balance(p_employee_id),
    v_card_id,
    v_period.start_date,
    v_period.end_date,
    (select tc.status from timecards tc where tc.id = v_card_id),
    coalesce((select count(*)::int from timecard_warnings(v_card_id)), 0);
end $$;

/*
 * Year-end report gains the accrual columns, so payroll can see that a
 * projection includes hours not yet earned.
 */
drop function if exists year_end_report(int);

create or replace function year_end_report(p_fiscal_year int default null)
returns table (
  employee_id        uuid,
  employee_number    text,
  first_name         text,
  last_name          text,
  employee_type      employee_type,
  snapshot_date      date,
  snapshot_vacation  numeric,
  snapshot_sick      numeric,
  pending_vacation   numeric,
  pending_sick       numeric,
  accrual_vacation   numeric,
  accrual_sick       numeric,
  has_accrual_rate   boolean,
  projected_vacation numeric,
  projected_sick     numeric,
  vacation_over      numeric,
  vacation_to_sick   numeric,
  vacation_forfeited numeric,
  sick_over          numeric,
  sick_to_vacation   numeric,
  final_vacation     numeric,
  final_sick         numeric,
  enter_vacation     numeric,
  enter_sick         numeric,
  needs_vacation_entry boolean,
  needs_sick_entry     boolean,
  action_required    boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may run the year-end report';
  end if;

  return query
  select
    e.id,
    e.employee_number,
    e.first_name,
    e.last_name,
    a.employee_type,
    p.snapshot_date,
    p.snapshot_vacation,
    p.snapshot_sick,
    p.pending_vacation,
    p.pending_sick,
    p.accrual_vacation,
    p.accrual_sick,
    p.has_accrual_rate,
    p.projected_vacation,
    p.projected_sick,
    p.vacation_over,
    p.vacation_to_sick,
    p.vacation_forfeited,
    p.sick_over,
    p.sick_to_vacation,
    p.final_vacation,
    p.final_sick,
    -- pre-add pending hours: payroll subtracts them when the period runs
    round(p.final_vacation + p.pending_vacation, 2),
    round(p.final_sick + p.pending_sick, 2),
    abs(p.final_vacation - p.projected_vacation) > 0.001,
    abs(p.final_sick - p.projected_sick) > 0.001,
    (abs(p.final_vacation - p.projected_vacation) > 0.001
     or abs(p.final_sick - p.projected_sick) > 0.001)
  from employees e
  join lateral (select * from assignment_on(e.id, current_date)) a on true
  join lateral (select * from year_end_projection(e.id, p_fiscal_year)) p on true
  where e.active
    and employed_on(e.id, current_date)
    and (p.snapshot_vacation > 0 or p.snapshot_sick > 0)
  order by
    (abs(p.final_vacation - p.projected_vacation) > 0.001
     or abs(p.final_sick - p.projected_sick) > 0.001) desc,
    p.vacation_over desc,
    e.last_name,
    e.first_name;
end $$;
