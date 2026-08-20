-- ============================================================
-- Phase 5r: salaried work-code split
--
-- Some salaried employees have their flat 80 hours split across two (or
-- more) work codes at fixed percentages - e.g. 25% Reardan clerical, 75%
-- Seed admin. The split is per-employee, the same codes and percentages
-- each period, and does not interact with time off: salaried always
-- exports 80 hours, now divided by the configured percentages.
--
-- Employees with no split configured keep the single flat line on their
-- default work code, exactly as before.
-- ============================================================

create table if not exists salaried_code_splits (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  work_code_id  uuid not null references work_codes(id),
  percent       numeric(5,2) not null check (percent > 0 and percent <= 100),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (employee_id, work_code_id)
);

create index if not exists salaried_code_splits_employee_idx
  on salaried_code_splits (employee_id, sort_order);

-- ------------------------------------------------------------
-- Return an employee's split as work-code lines for a given base hours.
-- Rounds each line to 2 decimals and puts any rounding remainder on the
-- last line, so the lines always sum exactly to the base.
-- ------------------------------------------------------------
create or replace function salaried_split_lines(
  p_employee_id uuid,
  p_base_hours  numeric
)
returns table (
  work_code_id uuid,
  code         text,
  description  text,
  percent      numeric,
  hours        numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_count    int;
  v_running  numeric := 0;
  v_idx      int := 0;
  r          record;
  v_line     numeric;
begin
  select count(*) into v_count
  from salaried_code_splits where employee_id = p_employee_id;

  if v_count = 0 then
    return;  -- no split; caller uses the single default-code line
  end if;

  for r in
    select s.work_code_id, wc.code, wc.description, s.percent
    from salaried_code_splits s
    join work_codes wc on wc.id = s.work_code_id
    where s.employee_id = p_employee_id
    order by s.sort_order, wc.code
  loop
    v_idx := v_idx + 1;
    if v_idx = v_count then
      -- last line takes the remainder so the total is exact
      v_line := round(p_base_hours - v_running, 2);
    else
      v_line := round(p_base_hours * r.percent / 100, 2);
      v_running := v_running + v_line;
    end if;

    work_code_id := r.work_code_id;
    code         := r.code;
    description  := r.description;
    percent      := r.percent;
    hours        := v_line;
    return next;
  end loop;
end $$;

-- ------------------------------------------------------------
-- Admin management of an employee's split. Replaces the whole split in
-- one call: pass arrays of work-code ids and percentages (same length,
-- percentages summing to 100). Empty arrays clear the split.
-- ------------------------------------------------------------
create or replace function set_salaried_split(
  p_employee_id  uuid,
  p_work_code_ids uuid[],
  p_percents      numeric[]
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sum numeric;
  i     int;
begin
  if not is_payroll_admin() then
    raise exception 'Only payroll admins may set salaried splits';
  end if;

  -- clear existing
  delete from salaried_code_splits where employee_id = p_employee_id;

  if p_work_code_ids is null or array_length(p_work_code_ids, 1) is null then
    return;  -- cleared, no new split
  end if;

  if array_length(p_work_code_ids, 1) <> array_length(p_percents, 1) then
    raise exception 'Work codes and percentages must be the same length';
  end if;

  if array_length(p_work_code_ids, 1) < 2 then
    raise exception 'A split needs at least two work codes';
  end if;

  select sum(p) into v_sum from unnest(p_percents) p;
  if round(v_sum, 2) <> 100 then
    raise exception 'Percentages must sum to 100 (got %)', v_sum;
  end if;

  for i in 1 .. array_length(p_work_code_ids, 1) loop
    insert into salaried_code_splits
      (employee_id, work_code_id, percent, sort_order)
    values
      (p_employee_id, p_work_code_ids[i], p_percents[i], i);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Read an employee's split for the admin UI.
-- ------------------------------------------------------------
create or replace function get_salaried_split(p_employee_id uuid)
returns table (
  work_code_id uuid,
  code         text,
  description  text,
  percent      numeric,
  sort_order   int
)
language sql stable security definer set search_path = public as $$
  select s.work_code_id, wc.code, wc.description, s.percent, s.sort_order
  from salaried_code_splits s
  join work_codes wc on wc.id = s.work_code_id
  where s.employee_id = p_employee_id
  order by s.sort_order, wc.code
$$;
