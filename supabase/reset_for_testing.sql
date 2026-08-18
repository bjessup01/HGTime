-- ============================================================
-- RESET FOR PRODUCTION TESTING  (run once, by hand)
--
-- Clears all transactional data so real time can be entered starting
-- from the 3/26/26-4/10/26 period. Keeps ALL employees and all
-- configuration — only the time/balance data is wiped.
--
-- KEEPS: every employee (with logins, assignments, employment periods,
--        supervisor links, code lists, accrual rates), pay periods,
--        work codes, schedules, holidays, shuttle levels, network
--        allowlist, year-end config.
--
-- CLEARS: timecards + entries + days, workweek ledger, floating-holiday
--         ledger, balance snapshots, year-end runs/results, audit log,
--         and manual grants.
--
-- This is destructive and has no undo. Take a Supabase backup first
-- (Database -> Backups), then run the whole script in one go.
-- ============================================================

do $$
begin
  -- year-end results cascade from runs, but clear both explicitly
  delete from year_end_results;
  delete from year_end_runs;

  -- ledgers
  delete from workweek_ledger;
  delete from floating_holiday_ledger;

  -- balances entered/imported
  delete from balance_snapshots;

  -- timecard tree: days and entries cascade from timecards, but delete
  -- children first so the intent is explicit
  delete from timecard_days;
  delete from timecard_entries;
  delete from timecards;

  -- audit log and any manual grants
  delete from audit_log;
  delete from grants;

  raise notice 'Reset complete. All employees and configuration kept; transactional data cleared.';
end $$;

-- --------------------------------------------------------
-- Verification — run these after, expect the results noted
-- --------------------------------------------------------
-- select count(*) from timecards;              -- 0
-- select count(*) from timecard_entries;       -- 0
-- select count(*) from timecard_days;          -- 0
-- select count(*) from workweek_ledger;        -- 0
-- select count(*) from floating_holiday_ledger;-- 0
-- select count(*) from balance_snapshots;      -- 0
-- select count(*) from year_end_runs;          -- 0
-- select count(*) from employees;              -- unchanged (all kept)
-- select count(*) from pay_periods;            -- unchanged
-- select count(*) from work_codes;             -- unchanged
-- select count(*) from accrual_rates;          -- unchanged

-- --------------------------------------------------------
-- Before entering time: confirm the 3/26/26-4/10/26 period
-- and everything after it exists. If this returns nothing,
-- generate the year first from Settings -> Pay periods, or:
--   select generate_semi_monthly_year(2026);
-- --------------------------------------------------------
-- select payroll_type, start_date, end_date
--   from pay_periods
--  where start_date >= '2026-03-26'
--  order by start_date;
