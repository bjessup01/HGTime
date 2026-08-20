-- ============================================================
-- Phase 5q: exempt cash-out codes from the 24-hour daily cap
--
-- The 24h/day cap catches data-entry errors on time that occupies the
-- day - worked hours and ordinary time off. A vacation cash-out is not
-- that: it's a payout recorded on a date, and can be far larger than 24
-- hours (a full accrued balance). Codes flagged allow_partial_hours (the
-- cash-out codes) are therefore excluded from the cap - both as the entry
-- being saved and when summing the day's other entries.
--
-- The floating-holiday balance check is unchanged.
-- ============================================================

create or replace function check_daily_hour_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total       numeric;
  v_employee_id uuid;
  v_is_float    boolean;
  v_available   numeric;
  v_this_exempt boolean;
begin
  -- is the entry being saved a cap-exempt (cash-out) code?
  select coalesce(toc.allow_partial_hours, false)
    into v_this_exempt
  from time_off_codes toc
  where toc.id = new.time_off_code_id;

  -- Only enforce the cap on non-exempt entries. A cash-out neither
  -- triggers the cap nor counts toward the day's total.
  if not coalesce(v_this_exempt, false) then
    select coalesce(sum(te.hours), 0) into v_total
    from timecard_entries te
    left join time_off_codes toc on toc.id = te.time_off_code_id
    where te.timecard_id = new.timecard_id
      and te.work_date = new.work_date
      and te.id <> new.id
      and not coalesce(toc.allow_partial_hours, false);   -- exclude cash-outs

    if v_total + new.hours > 24 then
      raise exception
        'A day cannot exceed 24 hours (this would make %)',
        to_char(v_total + new.hours, 'FM999990.00');
    end if;
  end if;

  -- floating holiday cannot exceed the banked balance (unchanged)
  select toc.is_floating_holiday into v_is_float
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
