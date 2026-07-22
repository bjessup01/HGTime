-- ============================================================
-- Phase 5b: audit view
-- ============================================================

/*
 * Human-readable change history.
 *
 * The audit_log stores full before/after JSON. This turns a row into
 * "who changed what, from what, to what, when" — the four things that
 * matter when someone asks about an edit.
 *
 * System-generated entries (holiday hours recalculating when worked
 * hours change) are excluded by default: a single employee edit can
 * cascade into several of them, and they are noise for the "who
 * touched my time" question.
 */
/*
 * Turn a log row into a short description of what was touched.
 */
create or replace function audit_describe(
  p_table  text,
  p_action text,
  p_before jsonb,
  p_after  jsonb
)
returns text
language plpgsql immutable set search_path = public as $$
declare
  v_code text;
  v_kind text;
begin
  if p_table = 'timecards' then
    if p_action = 'insert' then
      return 'Timecard opened';
    end if;
    -- status transitions are the interesting part
    if (p_before ->> 'status') is distinct from (p_after ->> 'status') then
      return 'Timecard status';
    end if;
    return 'Timecard updated';
  end if;

  if p_table = 'timecard_days' then
    if (p_before ->> 'holiday_election') is distinct from (p_after ->> 'holiday_election') then
      return 'Holiday choice';
    end if;
    if (p_before ->> 'shuttle_level_id') is distinct from (p_after ->> 'shuttle_level_id') then
      return 'Shuttle incentive';
    end if;
    if (p_before ->> 'salaried_confirmed') is distinct from (p_after ->> 'salaried_confirmed') then
      return 'Day confirmation';
    end if;
    return 'Day details';
  end if;

  -- timecard_entries
  v_kind := coalesce(p_after ->> 'kind', p_before ->> 'kind');

  select wc.code into v_code
  from work_codes wc
  where wc.id = coalesce(
    (p_after ->> 'work_code_id')::uuid,
    (p_before ->> 'work_code_id')::uuid
  );

  if v_code is null then
    select toc.code into v_code
    from time_off_codes toc
    where toc.id = coalesce(
      (p_after ->> 'time_off_code_id')::uuid,
      (p_before ->> 'time_off_code_id')::uuid
    );
  end if;

  return coalesce(v_code, case when v_kind = 'work' then 'Work' else 'Time off' end);
end $$;

/*
 * Render the meaningful state of a row as a short string.
 * Hours and codes are what people ask about; notes, times, and the
 * double-time flag are included when set.
 */
create or replace function audit_value(p_data jsonb, p_table text)
returns text
language plpgsql immutable set search_path = public as $$
declare
  v_parts text[] := '{}';
  v_hours text;
begin
  if p_data is null then
    return null;
  end if;

  if p_table = 'timecards' then
    return replace(coalesce(p_data ->> 'status', ''), '_', ' ');
  end if;

  if p_table = 'timecard_days' then
    if (p_data ->> 'holiday_election') is not null then
      return replace(p_data ->> 'holiday_election', '_', ' ');
    end if;
    if (p_data ->> 'salaried_confirmed')::boolean then
      return 'confirmed';
    end if;
    if (p_data ->> 'shuttle_level_id') is not null then
      return (select l.label from shuttle_incentive_levels l
              where l.id = (p_data ->> 'shuttle_level_id')::uuid);
    end if;
    return '—';
  end if;

  -- timecard_entries
  v_hours := p_data ->> 'hours';
  if v_hours is not null then
    v_parts := array_append(v_parts, trim(trailing '.' from
      trim(trailing '0' from v_hours)) || 'h');
  end if;

  if (p_data ->> 'start_time') is not null and (p_data ->> 'end_time') is not null then
    v_parts := array_append(v_parts,
      substring(p_data ->> 'start_time' from 1 for 5) || '-' ||
      substring(p_data ->> 'end_time' from 1 for 5));
  end if;

  if coalesce((p_data ->> 'double_time')::boolean, false) then
    v_parts := array_append(v_parts, 'double time');
  end if;

  if coalesce((p_data ->> 'unpaid')::boolean, false) then
    v_parts := array_append(v_parts, 'unpaid');
  end if;

  if (p_data ->> 'note') is not null and (p_data ->> 'note') <> '' then
    v_parts := array_append(v_parts, '"' || (p_data ->> 'note') || '"');
  end if;

  return array_to_string(v_parts, ', ');
end $$;

create or replace function timecard_history(
  p_timecard_id    uuid,
  p_include_system boolean default false
)
returns table (
  logged_at    timestamptz,
  actor_name   text,
  actor_number text,
  action       text,
  work_date    date,
  description  text,
  was          text,
  now_is       text,
  is_system    boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_employee_id uuid;
begin
  select employee_id into v_employee_id from timecards where id = p_timecard_id;

  if v_employee_id is null then
    raise exception 'Timecard not found';
  end if;

  if not can_view_employee(v_employee_id) then
    raise exception 'Not permitted to view this timecard';
  end if;

  return query
  select
    al.created_at,
    coalesce(e.first_name || ' ' || e.last_name, 'System'),
    e.employee_number,
    al.action,
    coalesce(
      (al.after_data ->> 'work_date')::date,
      (al.before_data ->> 'work_date')::date
    ),
    audit_describe(al.table_name, al.action, al.before_data, al.after_data),
    audit_value(al.before_data, al.table_name),
    audit_value(al.after_data, al.table_name),
    coalesce(
      (al.after_data ->> 'system_generated')::boolean,
      (al.before_data ->> 'system_generated')::boolean,
      false
    )
  from audit_log al
  left join employees e on e.id = al.actor_id
  where (
      (al.table_name = 'timecards' and al.record_id = p_timecard_id)
      or (al.table_name in ('timecard_entries', 'timecard_days')
          and coalesce(
                al.after_data ->> 'timecard_id',
                al.before_data ->> 'timecard_id'
              )::uuid = p_timecard_id)
    )
    and (
      p_include_system
      or not coalesce(
        (al.after_data ->> 'system_generated')::boolean,
        (al.before_data ->> 'system_generated')::boolean,
        false
      )
    )
  order by al.created_at desc;
end $$;

/*
 * Roster-wide audit search for payroll admins.
 */
create or replace function audit_search(
  p_from           date default null,
  p_to             date default null,
  p_employee_id    uuid default null,
  p_actor_id       uuid default null,
  p_include_system boolean default false,
  p_limit          int default 200
)
returns table (
  logged_at       timestamptz,
  actor_name      text,
  subject_name    text,
  subject_number  text,
  action          text,
  table_name      text,
  work_date       date,
  description     text,
  was             text,
  now_is          text,
  is_system       boolean,
  edited_by_other boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may search the audit log';
  end if;

  return query
  select
    al.created_at,
    coalesce(actor.first_name || ' ' || actor.last_name, 'System'),
    coalesce(subj.first_name || ' ' || subj.last_name, '—'),
    subj.employee_number,
    al.action,
    al.table_name,
    coalesce(
      (al.after_data ->> 'work_date')::date,
      (al.before_data ->> 'work_date')::date
    ),
    audit_describe(al.table_name, al.action, al.before_data, al.after_data),
    audit_value(al.before_data, al.table_name),
    audit_value(al.after_data, al.table_name),
    coalesce(
      (al.after_data ->> 'system_generated')::boolean,
      (al.before_data ->> 'system_generated')::boolean,
      false
    ),
    -- someone edited a card that is not their own
    al.actor_id is not null and al.actor_id is distinct from al.subject_employee_id
  from audit_log al
  left join employees actor on actor.id = al.actor_id
  left join employees subj  on subj.id  = al.subject_employee_id
  where al.table_name in ('timecards', 'timecard_entries', 'timecard_days')
    and (p_from is null or al.created_at >= p_from)
    and (p_to is null or al.created_at < p_to + 1)
    and (p_employee_id is null or al.subject_employee_id = p_employee_id)
    and (p_actor_id is null or al.actor_id = p_actor_id)
    and (
      p_include_system
      or not coalesce(
        (al.after_data ->> 'system_generated')::boolean,
        (al.before_data ->> 'system_generated')::boolean,
        false
      )
    )
  order by al.created_at desc
  limit p_limit;
end $$;

-- ------------------------------------------------------------
-- Purge
-- ------------------------------------------------------------

/*
 * How many audit rows are eligible for purge.
 *
 * Rolling two calendar years: the year that just ended is kept, the one
 * before it goes. Running in 2027 removes everything before 1/1/2026.
 *
 * This only removes the CHANGE HISTORY. Timecards, entries, ledgers,
 * balances, and year-end results are never touched.
 */
create or replace function audit_purge_preview()
returns table (
  cutoff_date   date,
  eligible_rows bigint,
  oldest_row    timestamptz,
  total_rows    bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cutoff date;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may purge the audit log';
  end if;

  -- keep the current year and the prior full year
  v_cutoff := make_date(extract(year from current_date)::int - 1, 1, 1);

  return query
  select
    v_cutoff,
    count(*) filter (where al.created_at < v_cutoff),
    min(al.created_at),
    count(*)
  from audit_log al;
end $$;

create or replace function audit_purge()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff date;
  v_count  int;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may purge the audit log';
  end if;

  v_cutoff := make_date(extract(year from current_date)::int - 1, 1, 1);

  delete from audit_log where created_at < v_cutoff;
  get diagnostics v_count = row_count;

  return v_count;
end $$;

create index if not exists audit_log_created_at_idx on audit_log (created_at desc);
create index if not exists audit_log_actor_idx on audit_log (actor_id, created_at desc);
