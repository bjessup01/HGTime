-- ============================================================
-- Audit trail for timecard changes
-- ============================================================

create or replace function log_timecard_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_timecard_id uuid;
  v_employee_id uuid;
  v_actor_id    uuid;
begin
  v_actor_id := current_employee_id();

  v_timecard_id := coalesce(
    (case when tg_op = 'DELETE' then old.timecard_id else new.timecard_id end),
    null
  );

  if tg_table_name = 'timecards' then
    v_employee_id := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  else
    select employee_id into v_employee_id from timecards where id = v_timecard_id;
  end if;

  insert into audit_log (table_name, record_id, action, actor_id, subject_employee_id,
                         before_data, after_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    v_actor_id,
    v_employee_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger audit_timecards
  after insert or update or delete on timecards
  for each row execute function log_timecard_change();

create trigger audit_timecard_entries
  after insert or update or delete on timecard_entries
  for each row execute function log_timecard_change();

create trigger audit_timecard_days
  after insert or update or delete on timecard_days
  for each row execute function log_timecard_change();

-- keep updated_at / updated_by current on entries
create or replace function touch_timecard_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := current_employee_id();
  return new;
end $$;

create trigger touch_timecard_entries
  before update on timecard_entries
  for each row execute function touch_timecard_entry();
