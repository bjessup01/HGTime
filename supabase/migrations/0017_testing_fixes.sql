-- ============================================================
-- Phase 5f: fixes and additions from testing
-- ============================================================

-- ------------------------------------------------------------
-- 5. Floating holiday code, tied to the banked balance
--
-- HOL stays system-generated (automatic holiday hours) and is hidden
-- from the employee picker. FLOATHOL is what an employee selects to
-- spend banked floating holiday time, and it cannot exceed the bank.
--
-- Payroll only cares about the bucket, so this exports as Other along
-- with Holiday.
-- ------------------------------------------------------------

insert into time_off_codes
  (code, description, bank, bucket, counts_toward_ot, payroll_admin_only,
   requires_zero_hours, default_unpaid, is_holiday_code, is_floating_holiday,
   sort_order)
values
  ('FLOATHOL', 'Floating Holiday', null, 'other', false, false,
   false, false, false, true, 85)
on conflict (code) do update set
  description = excluded.description,
  bucket = excluded.bucket,
  is_floating_holiday = true;

-- HOL is written by the system; employees use FLOATHOL instead.
update time_off_codes set is_floating_holiday = false where code = 'HOL';

/*
 * Floating holiday hours already spent on a timecard, excluding one
 * entry (so an edit does not count itself against the balance).
 */
create or replace function floating_holiday_used(
  p_employee_id     uuid,
  p_exclude_entry   uuid default null
)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(te.hours), 0)
  from timecard_entries te
  join timecards tc on tc.id = te.timecard_id
  join time_off_codes toc on toc.id = te.time_off_code_id
  where tc.employee_id = p_employee_id
    and toc.code = 'FLOATHOL'
    and (p_exclude_entry is null or te.id <> p_exclude_entry)
$$;

/*
 * Available floating holiday: earned in the ledger, less what has
 * already been entered on timecards but not yet reflected there.
 *
 * The ledger only records earnings at supervisor approval, so hours
 * entered on an open card have to be subtracted here or an employee
 * could spend the same hours twice.
 */
create or replace function floating_holiday_available(
  p_employee_id   uuid,
  p_exclude_entry uuid default null
)
returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(
    floating_holiday_balance(p_employee_id)
      - floating_holiday_used(p_employee_id, p_exclude_entry),
    0
  )
$$;

-- ------------------------------------------------------------
-- 6. Hard cap: no more than 24 hours on a single day
--
-- A day has 24 hours; anything beyond that is a data-entry error.
-- Unlike the other validations this blocks the save rather than
-- warning, because the result is never legitimate.
-- ------------------------------------------------------------

create or replace function check_daily_hour_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_employee_id uuid;
  v_is_float boolean;
  v_available numeric;
  v_code text;
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

  -- floating holiday cannot exceed the banked balance
  select toc.is_floating_holiday, toc.code into v_is_float, v_code
  from time_off_codes toc where toc.id = new.time_off_code_id;

  if coalesce(v_is_float, false) then
    select tc.employee_id into v_employee_id
    from timecards tc where tc.id = new.timecard_id;

    v_available := floating_holiday_available(v_employee_id, new.id);

    if new.hours > v_available then
      raise exception
        'Only % floating holiday hours are available',
        to_char(v_available, 'FM999990.00');
    end if;
  end if;

  return new;
end $$;

drop trigger if exists enforce_daily_cap on timecard_entries;
create trigger enforce_daily_cap
  before insert or update on timecard_entries
  for each row execute function check_daily_hour_cap();

-- ------------------------------------------------------------
-- 7. Apply time off across a date range
-- ------------------------------------------------------------

/*
 * Preview what a range application would do, so the employee sees it
 * before committing.
 *
 * Skipped, per the rules we settled:
 *   - days they are not scheduled to work
 *   - days that already have entries
 *   - observed holidays (hours are already applied there)
 *   - days outside employment
 */
create or replace function preview_range_time_off(
  p_timecard_id uuid,
  p_from        date,
  p_to          date
)
returns table (
  work_date       date,
  scheduled_hours numeric,
  will_apply      boolean,
  skip_reason     text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_period_id   uuid;
begin
  select employee_id, pay_period_id into v_employee_id, v_period_id
    from timecards where id = p_timecard_id;

  return query
  select
    s.work_date,
    s.scheduled_hours,
    s.is_employed
      and s.is_scheduled_day
      and s.holiday_hours = 0
      and not exists (
        select 1 from timecard_entries te
        where te.timecard_id = p_timecard_id and te.work_date = s.work_date
      ),
    case
      when not s.is_employed then 'not employed'
      when not s.is_scheduled_day then 'not scheduled'
      when s.holiday_hours > 0 then 'holiday'
      when exists (
        select 1 from timecard_entries te
        where te.timecard_id = p_timecard_id and te.work_date = s.work_date
      ) then 'already has time'
      else null
    end
  from timecard_days_scaffold(v_employee_id, v_period_id) s
  where s.work_date between p_from and p_to
  order by s.work_date;
end $$;

/*
 * Apply a time-off code across a date range at each day's scheduled
 * hours. Returns how many days were filled.
 */
create or replace function apply_range_time_off(
  p_timecard_id     uuid,
  p_from            date,
  p_to              date,
  p_time_off_code_id uuid,
  p_note            text default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid;
  v_zero        boolean;
  v_applied     int := 0;
  r             record;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  select requires_zero_hours into v_zero
    from time_off_codes where id = p_time_off_code_id;

  for r in
    select * from preview_range_time_off(p_timecard_id, p_from, p_to)
    where will_apply
  loop
    insert into timecard_entries
      (timecard_id, work_date, kind, time_off_code_id, hours, note, created_by)
    values
      (p_timecard_id, r.work_date, 'time_off', p_time_off_code_id,
       case when coalesce(v_zero, false) then 0 else r.scheduled_hours end,
       p_note, current_employee_id());

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end $$;

-- ------------------------------------------------------------
-- 2. Editable work codes
-- ------------------------------------------------------------

create or replace function update_work_code(
  p_id          uuid,
  p_code        text,
  p_description text
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may edit work codes';
  end if;

  update work_codes
     set code = upper(trim(p_code)),
         description = trim(p_description)
   where id = p_id;
end $$;

-- ------------------------------------------------------------
-- Give the new floating-holiday code to everyone who already has
-- Holiday allowed, so it appears without re-editing each employee.
-- ------------------------------------------------------------

insert into employee_time_off_codes (employee_id, time_off_code_id)
select distinct etoc.employee_id,
       (select id from time_off_codes where code = 'FLOATHOL')
from employee_time_off_codes etoc
join time_off_codes toc on toc.id = etoc.time_off_code_id
where toc.code = 'HOL'
on conflict do nothing;

-- HOL is system-generated; remove it from employee pickers so it is
-- not selectable by hand. System entries are written directly and are
-- unaffected by this.
delete from employee_time_off_codes
where time_off_code_id = (select id from time_off_codes where code = 'HOL');
