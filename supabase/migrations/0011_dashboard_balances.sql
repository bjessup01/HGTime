-- ============================================================
-- Phase 4.5: balances, year-end projection, employee dashboard
-- ============================================================

-- Track where a balance came from, so corrections are distinguishable
-- from imports when reconciling against payroll.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'balance_snapshots' and column_name = 'source'
  ) then
    alter table balance_snapshots add column source text not null default 'import';
    alter table balance_snapshots add column note text;
    alter table balance_snapshots add column recorded_by uuid references employees(id);
  end if;
end $$;

/*
 * Most recent balance for an employee and bank.
 *
 * Balances are snapshots imported from payroll after each run, not a
 * running ledger. The latest snapshot is the truth as of its date.
 */
create or replace function current_balance(
  p_employee_id uuid,
  p_bank        balance_bank
)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select hours from balance_snapshots
    where employee_id = p_employee_id and bank = p_bank
    order by as_of_date desc, imported_at desc
    limit 1
  ), 0)
$$;

create or replace function current_balance_date(
  p_employee_id uuid,
  p_bank        balance_bank
)
returns date
language sql stable security definer set search_path = public as $$
  select (
    select as_of_date from balance_snapshots
    where employee_id = p_employee_id and bank = p_bank
    order by as_of_date desc, imported_at desc
    limit 1
  )
$$;

/*
 * Time off recorded in this app since the balance snapshot date,
 * drawing on a given bank.
 *
 * This is the gap payroll cannot see: the 3/26-4/10 period has not
 * processed yet, so the imported snapshot is stale for those days.
 * This app owns those entries, so it can close the gap.
 */
create or replace function time_off_since_snapshot(
  p_employee_id uuid,
  p_bank        balance_bank,
  p_since       date,
  p_through     date default null
)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(te.hours), 0)
  from timecard_entries te
  join timecards tc on tc.id = te.timecard_id
  join time_off_codes toc on toc.id = te.time_off_code_id
  where tc.employee_id = p_employee_id
    and toc.bank = p_bank
    and te.kind = 'time_off'
    and not te.unpaid
    and te.work_date > p_since
    and (p_through is null or te.work_date <= p_through)
$$;

/*
 * Projected balance as of a date, accounting for time off this app
 * knows about but payroll has not yet processed.
 */
create or replace function projected_balance(
  p_employee_id uuid,
  p_bank        balance_bank,
  p_as_of       date
)
returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(
    current_balance(p_employee_id, p_bank)
      - time_off_since_snapshot(
          p_employee_id,
          p_bank,
          coalesce(current_balance_date(p_employee_id, p_bank), '1900-01-01'::date),
          p_as_of
        ),
    0
  )
$$;

/*
 * Fiscal year-end conversion, computed for one employee.
 *
 * Step 1 (end of 3/31): vacation over the cap converts to sick 1:1, up
 * to the sick cap. Anything still over is forfeited. If sick is already
 * full there is no room, so all excess vacation is forfeited outright.
 *
 * Step 2 (4/1): sick over the cap converts to vacation at 3:1 (three
 * sick hours yield one vacation hour). This lands AFTER the truncation,
 * so vacation can exceed its cap on 4/1.
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
  vacation_to_use     numeric
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
  v_sick_consumed  numeric;
begin
  select * into cfg from year_end_config where active order by effective_from desc limit 1;
  if cfg is null then
    raise exception 'No active year_end_config row';
  end if;

  -- fiscal year end is the next occurrence of month/day from today
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

  -- time off already entered here but not yet processed by payroll
  v_pend_vac := time_off_since_snapshot(
    p_employee_id, 'vacation',
    coalesce(v_snap_vac_date, '1900-01-01'::date), v_fy_end);
  v_pend_sick := time_off_since_snapshot(
    p_employee_id, 'sick',
    coalesce(v_snap_sick_date, '1900-01-01'::date), v_fy_end);

  v_proj_vac  := greatest(v_snap_vac - v_pend_vac, 0);
  v_proj_sick := greatest(v_snap_sick - v_pend_sick, 0);

  -- ---- Step 1: end of 3/31 ----
  v_vac_over    := greatest(v_proj_vac - cfg.vacation_carryover_max, 0);
  v_sick_room   := greatest(cfg.sick_carryover_max - v_proj_sick, 0);
  v_vac_to_sick := least(v_vac_over * cfg.vacation_to_sick_ratio, v_sick_room);
  v_vac_forfeit := greatest(v_vac_over - v_vac_to_sick, 0);

  v_vac_after  := v_proj_vac - v_vac_over;           -- capped at the max
  v_sick_after := v_proj_sick + v_vac_to_sick;

  -- ---- Step 2: 4/1 ----
  v_sick_over     := greatest(v_sick_after - cfg.sick_carryover_max, 0);
  v_sick_to_vac   := floor(v_sick_over / cfg.sick_to_vacation_divisor);
  v_sick_consumed := v_sick_to_vac * cfg.sick_to_vacation_divisor;

  return query select
    v_fy_end,
    cfg.vacation_carryover_max,
    cfg.sick_carryover_max,
    v_snap_vac,
    v_snap_sick,
    coalesce(v_snap_vac_date, v_snap_sick_date),
    v_pend_vac,
    v_pend_sick,
    v_proj_vac,
    v_proj_sick,
    v_vac_over,
    v_sick_room,
    v_vac_to_sick,
    v_vac_forfeit,
    v_sick_over,
    v_sick_to_vac,
    v_sick_consumed,
    v_vac_after + v_sick_to_vac,
    v_sick_after - v_sick_consumed,
    -- hours the employee should use before year end to avoid losing them
    v_vac_over;
end $$;

/*
 * Import a balance snapshot. Upserts on (employee, bank, date) so
 * re-running an import corrects rather than duplicates.
 */
create or replace function import_balance(
  p_employee_number text,
  p_bank            balance_bank,
  p_hours           numeric,
  p_as_of           date,
  p_source          text default 'import',
  p_note            text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_id          uuid;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may import balances';
  end if;

  select id into v_employee_id from employees
   where employee_number = p_employee_number;

  if v_employee_id is null then
    raise exception 'No employee with number %', p_employee_number;
  end if;

  insert into balance_snapshots
    (employee_id, bank, hours, as_of_date, source, note, recorded_by)
  values
    (v_employee_id, p_bank, p_hours, p_as_of, p_source, p_note, current_employee_id())
  on conflict (employee_id, bank, as_of_date)
  do update set
    hours       = excluded.hours,
    source      = excluded.source,
    note        = excluded.note,
    recorded_by = excluded.recorded_by,
    imported_at = now()
  returning id into v_id;

  return v_id;
end $$;

/* Employees may read their own balance history. */
drop policy if exists balance_snapshots_read on balance_snapshots;
create policy balance_snapshots_read on balance_snapshots for select to authenticated
  using (can_view_employee(employee_id));

/*
 * Everything the employee dashboard needs in one call.
 */
create or replace function employee_dashboard(p_employee_id uuid)
returns table (
  vacation_balance      numeric,
  vacation_as_of        date,
  vacation_pending      numeric,
  vacation_projected    numeric,
  sick_balance          numeric,
  sick_as_of            date,
  sick_pending          numeric,
  sick_projected        numeric,
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
    projected_balance(p_employee_id, 'vacation', current_date + 365),
    current_balance(p_employee_id, 'sick'),
    current_balance_date(p_employee_id, 'sick'),
    time_off_since_snapshot(p_employee_id, 'sick',
      coalesce(current_balance_date(p_employee_id, 'sick'), '1900-01-01'::date), null),
    projected_balance(p_employee_id, 'sick', current_date + 365),
    floating_holiday_balance(p_employee_id),
    v_card_id,
    v_period.start_date,
    v_period.end_date,
    (select tc.status from timecards tc where tc.id = v_card_id),
    coalesce((select count(*)::int from timecard_warnings(v_card_id)), 0);
end $$;
