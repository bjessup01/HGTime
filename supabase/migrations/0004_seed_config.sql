-- ============================================================
-- Seed: configuration data
-- ============================================================

-- ---------- time-off codes ----------
-- bucket confirmed from payroll system screenshots.
-- Holiday is the ONLY code with counts_toward_ot = true.

insert into time_off_codes
  (code, description, bank, bucket, counts_toward_ot, payroll_admin_only,
   requires_zero_hours, default_unpaid, is_holiday_code, sort_order)
values
  ('VAC',   'Vacation',                  'vacation', 'vacation', false, false, false, false, false, 10),
  ('SICK',  'Employee Sickness',         'sick',     'sick',     false, false, false, false, false, 20),
  ('MED',   'Medical/Dental Appt',       'sick',     'sick',     false, false, false, false, false, 30),
  ('FAMC',  'Family Care',               'sick',     'sick',     false, false, false, false, false, 40),
  ('FMLA',  'FMLA',                      'sick',     'sick',     false, true,  false, false, false, 50),
  ('IOJ',   'Injury On the Job',         null,       'other',    false, false, false, false, false, 60),
  ('IOFF',  'Injury Off the Job',        'sick',     'sick',     false, false, false, false, false, 70),
  ('HOL',   'Holiday',                   null,       'other',    true,  false, false, false, true,  80),
  ('FUN',   'Funeral',                   null,       'other',    false, false, false, false, false, 90),
  ('JURY',  'Jury Duty',                 null,       'other',    false, false, false, false, false, 100),
  ('OTHER', 'Other',                     null,       'other',    false, true,  false, false, false, 110),
  ('LWOP',  'Leave Without Pay',         null,       'other',    false, false, true,  true,  false, 120),
  ('EXC',   'Excused Absence',           null,       'other',    false, false, false, false, false, 130),
  ('MIL',   'Military Leave',            null,       'other',    false, true,  false, false, false, 140),
  ('IKSD',  'In Kind Service Donation',  null,       'other',    false, false, false, false, false, 150),
  ('WAPFL', 'WA Paid Family Leave',      null,       'other',    false, true,  false, false, false, 160),
  ('VCO',   'Vacation Cash Out',         'vacation', 'vacation', false, true,  false, false, false, 170);

-- Floating holiday is recorded under the Holiday code (per the code manual),
-- tracked separately via floating_holiday_ledger.
update time_off_codes set is_floating_holiday = true where code = 'HOL';

-- ---------- work schedules ----------

insert into work_schedules
  (code, name, holiday_hours, holiday_conversion_rule,
   holiday_friday_split, friday_split_thursday_hours, friday_split_friday_hours)
values
  ('4x10',  '4 x 10s (Mon-Thu)',        10, true,  false, null, null),
  ('4x9+4', '4 x 9s + 4 on Friday',      9, false, true,  5,    4),
  ('5x8',   '5 x 8s (Mon-Fri)',          8, false, false, null, null);

-- scheduled hours + half-day-OFF hours per weekday (0=Sun .. 6=Sat)
-- 4x10: Mon-Thu 10s. Half day off = 5.
insert into work_schedule_days (schedule_id, dow, scheduled_hours, half_day_off_hours)
select id, d.dow, d.hrs, d.half
from work_schedules, (values
  (0,0::numeric,0::numeric),(1,10,5),(2,10,5),(3,10,5),(4,10,5),(5,0,0),(6,0,0)
) as d(dow,hrs,half)
where code = '4x10';

-- 4x9+4: Mon-Thu 9s (half day off = 5, work 4 in the morning), Fri 4 (half day = full 4 off)
insert into work_schedule_days (schedule_id, dow, scheduled_hours, half_day_off_hours)
select id, d.dow, d.hrs, d.half
from work_schedules, (values
  (0,0::numeric,0::numeric),(1,9,5),(2,9,5),(3,9,5),(4,9,5),(5,4,4),(6,0,0)
) as d(dow,hrs,half)
where code = '4x9+4';

-- 5x8: Mon-Fri 8s. Half day off = 4.
insert into work_schedule_days (schedule_id, dow, scheduled_hours, half_day_off_hours)
select id, d.dow, d.hrs, d.half
from work_schedules, (values
  (0,0::numeric,0::numeric),(1,8,4),(2,8,4),(3,8,4),(4,8,4),(5,8,4),(6,0,0)
) as d(dow,hrs,half)
where code = '5x8';

-- ---------- shuttle incentive levels ----------

insert into shuttle_incentive_levels (amount, label, criteria, sort_order) values
  (50,  '$50',  'Weekday 4am-6am or 6pm-8pm', 10),
  (100, '$100', 'Weekday work beginning in or extending into 8pm-4am', 20),
  (200, '$200', 'Weekend (8pm Friday through 4am Monday)', 30),
  (250, '$250', 'Holiday', 40);

-- ---------- year-end config ----------

insert into year_end_config
  (fiscal_year_end_month, fiscal_year_end_day,
   vacation_carryover_max, sick_carryover_max,
   vacation_to_sick_ratio, sick_to_vacation_divisor)
values (3, 31, 160, 480, 1.0, 3.0);
