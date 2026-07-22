-- ============================================================
-- Timekeeping — Phase 1: Core Schema
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
create type payroll_type    as enum ('semi_monthly', 'bi_weekly');
create type employee_type   as enum ('salaried', 'full_time_hourly', 'part_time', 'on_call', 'seasonal');
create type app_role        as enum ('employee', 'supervisor', 'payroll_admin');
create type balance_bank    as enum ('vacation', 'sick');
create type export_bucket   as enum ('vacation', 'sick', 'other');
create type entry_kind      as enum ('work', 'time_off');
create type timecard_status as enum ('open', 'employee_approved', 'supervisor_approved', 'exported');
create type holiday_election as enum ('floating_holiday', 'double_time');
create type grant_kind      as enum ('holiday', 'excused_absence');
create type day_portion     as enum ('full', 'half');

-- ============================================================
-- CONFIG
-- ============================================================

create table work_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- e.g. WHPEDAV
  description text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table time_off_codes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  description          text not null,
  bank                 balance_bank,          -- null = draws from no bank
  bucket               export_bucket not null,
  counts_toward_ot     boolean not null default false,
  payroll_admin_only   boolean not null default false,  -- payroll-use-only + HR-directed codes
  requires_zero_hours  boolean not null default false,
  default_unpaid       boolean not null default false,
  is_holiday_code      boolean not null default false,
  is_floating_holiday  boolean not null default false,
  sort_order           int not null default 100,
  active               boolean not null default true
);

-- Work schedules: named patterns with per-weekday expected + half-day-off hours.
create table work_schedules (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,           -- '4x10', '4x9+4', '5x8'
  name        text not null,
  holiday_hours numeric(5,2) not null,        -- full holiday value for this schedule
  -- 4x10 is the only schedule subject to the Friday-holiday conversion rule
  holiday_conversion_rule boolean not null default false,
  -- when an observed holiday lands on Friday, 4x9+4 splits across Thu/Fri
  holiday_friday_split boolean not null default false,
  friday_split_thursday_hours numeric(5,2),
  friday_split_friday_hours   numeric(5,2),
  active      boolean not null default true
);

-- dow: 0=Sunday .. 6=Saturday
create table work_schedule_days (
  schedule_id     uuid not null references work_schedules(id) on delete cascade,
  dow             int  not null check (dow between 0 and 6),
  scheduled_hours numeric(5,2) not null default 0,
  half_day_off_hours numeric(5,2) not null default 0,  -- hours OFF when a half day is granted
  primary key (schedule_id, dow)
);

create table holidays (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  actual_date   date not null,
  observed_date date not null,
  year          int  not null,
  active        boolean not null default true,
  unique (name, year)
);
create index on holidays (observed_date);

create table shuttle_incentive_levels (
  id          uuid primary key default gen_random_uuid(),
  amount      numeric(8,2) not null unique,
  label       text not null,
  criteria    text not null,
  sort_order  int not null default 100,
  active      boolean not null default true
);

-- Fiscal year-end carryover config (data, not hardcoded)
create table year_end_config (
  id                        uuid primary key default gen_random_uuid(),
  fiscal_year_end_month     int not null default 3,
  fiscal_year_end_day       int not null default 31,
  vacation_carryover_max    numeric(7,2) not null default 160,
  sick_carryover_max        numeric(7,2) not null default 480,
  -- step 1: vacation over max -> sick, 1:1, up to sick cap; remainder forfeited
  vacation_to_sick_ratio    numeric(6,3) not null default 1.0,
  -- step 2: sick over max -> vacation, 3 sick yields 1 vacation
  sick_to_vacation_divisor  numeric(6,3) not null default 3.0,
  effective_from            date not null default '2000-01-01',
  active                    boolean not null default true
);

-- ============================================================
-- PEOPLE
-- ============================================================

create table employees (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique,                    -- supabase auth.users.id
  employee_number text not null unique,
  first_name      text not null,
  last_name       text not null,
  role            app_role not null default 'employee',
  can_enter_remotely boolean not null default false,
  shuttle_eligible   boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index on employees (auth_user_id);

-- Rehire history; original hire date = min(hire_date)
create table employment_periods (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  hire_date   date not null,
  term_date   date,
  term_reason text,
  created_at  timestamptz not null default now(),
  check (term_date is null or term_date >= hire_date)
);
create index on employment_periods (employee_id, hire_date);

-- Effective-dated attributes. A change = a new row.
create table employee_assignments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete cascade,
  payroll_type     payroll_type not null,
  employee_type    employee_type not null,
  schedule_id      uuid not null references work_schedules(id),
  default_work_code_id uuid references work_codes(id),
  holiday_eligible boolean not null default false,
  effective_from   date not null,
  effective_to     date,                         -- null = current
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index on employee_assignments (employee_id, effective_from desc);

create table employee_work_codes (
  employee_id  uuid not null references employees(id) on delete cascade,
  work_code_id uuid not null references work_codes(id) on delete cascade,
  primary key (employee_id, work_code_id)
);

create table employee_time_off_codes (
  employee_id       uuid not null references employees(id) on delete cascade,
  time_off_code_id  uuid not null references time_off_codes(id) on delete cascade,
  primary key (employee_id, time_off_code_id)
);

create table supervisor_assignments (
  employee_id   uuid not null references employees(id) on delete cascade,
  supervisor_id uuid not null references employees(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (employee_id, supervisor_id),
  check (employee_id <> supervisor_id)
);
create index on supervisor_assignments (supervisor_id);

-- Company network allowlist (static IPs per location)
create table network_allowlist (
  id         uuid primary key default gen_random_uuid(),
  location   text not null,
  cidr       cidr not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PERIODS & TIMECARDS
-- ============================================================

create table pay_periods (
  id           uuid primary key default gen_random_uuid(),
  payroll_type payroll_type not null,
  start_date   date not null,
  end_date     date not null,
  locked_at    timestamptz,
  exported_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (payroll_type, start_date),
  check (end_date > start_date)
);
create index on pay_periods (payroll_type, start_date desc);

create table timecards (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  pay_period_id uuid not null references pay_periods(id) on delete cascade,
  status        timecard_status not null default 'open',
  employee_approved_at   timestamptz,
  employee_approved_by   uuid references employees(id),
  supervisor_approved_at timestamptz,
  supervisor_approved_by uuid references employees(id),
  exported_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (employee_id, pay_period_id)
);
create index on timecards (pay_period_id, status);

create table timecard_entries (
  id             uuid primary key default gen_random_uuid(),
  timecard_id    uuid not null references timecards(id) on delete cascade,
  work_date      date not null,
  kind           entry_kind not null,
  work_code_id   uuid references work_codes(id),
  time_off_code_id uuid references time_off_codes(id),
  hours          numeric(6,2) not null default 0,
  start_time     time,
  end_time       time,
  double_time    boolean not null default false,  -- export splits into duplicate work-code line
  unpaid         boolean not null default false,  -- per-entry; e.g. military leave case-by-case
  system_generated boolean not null default false, -- holiday/excused-absence grants
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references employees(id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references employees(id),
  check (
    (kind = 'work'     and work_code_id is not null and time_off_code_id is null) or
    (kind = 'time_off' and time_off_code_id is not null)
  )
);
create index on timecard_entries (timecard_id, work_date);

-- Per-day attachments: shuttle level, holiday election, salaried confirmation
create table timecard_days (
  id                uuid primary key default gen_random_uuid(),
  timecard_id       uuid not null references timecards(id) on delete cascade,
  work_date         date not null,
  shuttle_level_id  uuid references shuttle_incentive_levels(id),
  holiday_election  holiday_election,
  election_note     text,
  salaried_confirmed boolean not null default false,
  unique (timecard_id, work_date)
);

-- Bulk grants: holiday or CEO-granted excused absence, schedule-aware
create table grants (
  id          uuid primary key default gen_random_uuid(),
  kind        grant_kind not null,
  grant_date  date not null,
  portion     day_portion not null default 'full',
  holiday_id  uuid references holidays(id),
  description text,
  created_at  timestamptz not null default now(),
  created_by  uuid references employees(id)
);

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  table_name   text not null,
  record_id    uuid not null,
  action       text not null,          -- insert | update | delete
  actor_id     uuid references employees(id),
  subject_employee_id uuid references employees(id),
  before_data  jsonb,
  after_data   jsonb,
  created_at   timestamptz not null default now()
);
create index on audit_log (subject_employee_id, created_at desc);
create index on audit_log (table_name, record_id);

-- ============================================================
-- BALANCES & OT
-- ============================================================

-- Imported from payroll after each run
create table balance_snapshots (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  bank        balance_bank not null,
  hours       numeric(7,2) not null,
  as_of_date  date not null,
  imported_at timestamptz not null default now(),
  unique (employee_id, bank, as_of_date)
);
create index on balance_snapshots (employee_id, bank, as_of_date desc);

-- Earned by working a holiday; spent under the Holiday code
create table floating_holiday_ledger (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  hours       numeric(6,2) not null,       -- positive = earned, negative = used
  work_date   date not null,
  reason      text not null,
  timecard_entry_id uuid references timecard_entries(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on floating_holiday_ledger (employee_id, work_date);

-- The key table for split-week OT lookback.
-- One row per employee per Sun-Sat workweek per pay period that paid into it.
create table workweek_ledger (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id) on delete cascade,
  week_start     date not null,              -- Sunday
  pay_period_id  uuid not null references pay_periods(id) on delete cascade,
  regular_hours  numeric(7,2) not null default 0,
  ot_hours       numeric(7,2) not null default 0,
  computed_at    timestamptz not null default now(),
  unique (employee_id, week_start, pay_period_id)
);
create index on workweek_ledger (employee_id, week_start);

-- Year-end conversion runs (advisory)
create table year_end_runs (
  id            uuid primary key default gen_random_uuid(),
  fiscal_year   int not null,
  run_at        timestamptz not null default now(),
  run_by        uuid references employees(id),
  notes         text
);

create table year_end_results (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references year_end_runs(id) on delete cascade,
  employee_id            uuid not null references employees(id) on delete cascade,
  snapshot_vacation      numeric(7,2) not null,
  snapshot_sick          numeric(7,2) not null,
  pending_vacation_used  numeric(7,2) not null default 0,  -- entered 3/26-3/31
  pending_sick_used      numeric(7,2) not null default 0,
  projected_vacation     numeric(7,2) not null,
  projected_sick         numeric(7,2) not null,
  vacation_to_sick       numeric(7,2) not null default 0,  -- step 1, 1:1
  vacation_forfeited     numeric(7,2) not null default 0,  -- step 1 remainder
  sick_to_vacation       numeric(7,2) not null default 0,  -- step 2, 3:1 result
  sick_consumed          numeric(7,2) not null default 0,  -- step 2 input
  final_vacation         numeric(7,2) not null,
  final_sick             numeric(7,2) not null,
  unique (run_id, employee_id)
);
