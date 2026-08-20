-- ============================================================
-- Phase 5p: allow partial hours on specific time-off codes
--
-- Timecard hours are quarter-hour based, which is right for worked time
-- and ordinary time off. But a vacation cash-out is a dollar figure
-- converted to hours and lands on values like 3.55. Flag such codes so
-- their hours field accepts hundredths while everything else stays on
-- the 0.25 step.
-- ============================================================

alter table time_off_codes
  add column if not exists allow_partial_hours boolean not null default false;

-- Vacation Cash Out is entered as a converted dollar amount.
update time_off_codes set allow_partial_hours = true where code = 'VCO';
