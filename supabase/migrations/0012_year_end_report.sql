-- ============================================================
-- Phase 5a: year-end conversion report
-- ============================================================

/*
 * Fix the 3:1 conversion: balances are not rounded to the quarter
 * hour, so partial hours convert. 61h over the cap yields 20.33h
 * vacation and consumes the full 61h, landing sick exactly at the cap.
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

  v_proj_vac  := greatest(v_snap_vac - v_pend_vac, 0);
  v_proj_sick := greatest(v_snap_sick - v_pend_sick, 0);

  -- Step 1: end of 3/31
  v_vac_over    := greatest(v_proj_vac - cfg.vacation_carryover_max, 0);
  v_sick_room   := greatest(cfg.sick_carryover_max - v_proj_sick, 0);
  v_vac_to_sick := least(v_vac_over * cfg.vacation_to_sick_ratio, v_sick_room);
  v_vac_forfeit := greatest(v_vac_over - v_vac_to_sick, 0);

  v_vac_after  := v_proj_vac - v_vac_over;
  v_sick_after := v_proj_sick + v_vac_to_sick;

  -- Step 2: 4/1 — partial hours convert; the full excess is consumed
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
    v_vac_over;
end $$;

/*
 * Roster-wide year-end report.
 *
 * Two numbers per employee per bank that must not be confused:
 *
 *   final_*  - what the employee actually ends up with
 *   enter_*  - what payroll types into the payroll system
 *
 * They differ when there is time off entered here that payroll has not
 * processed yet. The 3/26-4/10 period is still open on 4/1, so payroll
 * will subtract those hours when it runs. The entered figure pre-adds
 * them so they are not subtracted twice.
 *
 *   Example: snapshot 180 vacation, 10h used 3/26.
 *     true balance 170, cap 160, so 10h is lost.
 *     employee ends at 160.
 *     payroll enters 170; the period run subtracts 10; lands at 160.
 */
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
    -- only employees with a bank to convert
    and (p.snapshot_vacation > 0 or p.snapshot_sick > 0)
  order by
    (abs(p.final_vacation - p.projected_vacation) > 0.001
     or abs(p.final_sick - p.projected_sick) > 0.001) desc,
    p.vacation_over desc,
    e.last_name,
    e.first_name;
end $$;

/*
 * Record that a year-end run happened, capturing the numbers as they
 * stood. Payroll works from the saved run rather than a live query, so
 * the figures they keyed in remain auditable afterward.
 */
create or replace function save_year_end_run(
  p_fiscal_year int,
  p_notes       text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_run_id uuid;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may save a year-end run';
  end if;

  insert into year_end_runs (fiscal_year, run_by, notes)
  values (p_fiscal_year, current_employee_id(), p_notes)
  returning id into v_run_id;

  insert into year_end_results (
    run_id, employee_id,
    snapshot_vacation, snapshot_sick,
    pending_vacation_used, pending_sick_used,
    projected_vacation, projected_sick,
    vacation_to_sick, vacation_forfeited,
    sick_to_vacation, sick_consumed,
    final_vacation, final_sick
  )
  select
    v_run_id, r.employee_id,
    r.snapshot_vacation, r.snapshot_sick,
    r.pending_vacation, r.pending_sick,
    r.projected_vacation, r.projected_sick,
    r.vacation_to_sick, r.vacation_forfeited,
    r.sick_to_vacation, r.sick_over,
    r.final_vacation, r.final_sick
  from year_end_report(p_fiscal_year) r;

  return v_run_id;
end $$;
