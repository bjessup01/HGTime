# Timekeeping — Phase 2

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.local.example` to `.env.local` and fill in from your Supabase
project (Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
EMPLOYEE_EMAIL_DOMAIN=timekeeping.local
```

The service role key bypasses RLS and is only used server-side for creating
accounts and resetting PINs. Never expose it to the browser — it has no
`NEXT_PUBLIC_` prefix for that reason.

### 3. Run migration 0006

In the Supabase SQL Editor, run `supabase/migrations/0006_auth_helpers.sql`.
Migrations 0001–0005 are already applied.

### 4. Create the first admin

RLS blocks everything until an admin exists, and creating an admin requires
being one. Break the cycle once:

1. Supabase dashboard → **Authentication** → **Users** → **Add user**
   - Email: `1001@timekeeping.local` (substitute your employee number)
   - Password: a 6-digit PIN you choose
   - Check **Auto Confirm User**
2. Copy the new user's UUID
3. Edit the values at the top of `supabase/bootstrap_admin.sql` and run it
   in the SQL Editor

### 5. Start

```bash
npm run dev
```

Sign in at `/login` with your employee number and the PIN from step 4.

## What works

- **Login** — employee number + 6-digit PIN. Supabase Auth maps the number to
  a synthetic email the employee never sees.
- **Employees** (`/admin/employees`) — add employees with generated PINs,
  effective-dated assignments, employment history, supervisors, per-employee
  work and time-off code lists, PIN reset.
- **Work codes** (`/admin/work-codes`) — add and deactivate work codes; view
  the seeded time-off codes with their export buckets.
- **Networks** (`/admin/networks`) — manage the IP allowlist. Shows your
  current IP so you can add each location by visiting from there.

## Notes

- **Generated PINs display once.** They're stored as bcrypt hashes and can't
  be retrieved — only reset.
- **Holiday eligibility** defaults from employee type (salaried and full-time
  hourly get it) but is overridable per employee.
- **Salaried is semi-monthly only** — the form enforces this.
- **The IP check** lives in the `may_enter_time` database function so the rule
  has one home. Supervisors and payroll admins are never restricted; employees
  flagged `can_enter_remotely` bypass it.

## Order of operations for testing

1. Add 3–5 work codes
2. Add 2–3 employees (vary the schedule — include one 4×10, since that
   schedule carries the holiday conversion rule)
3. Assign supervisors so the approval chain has something to exercise
4. Add your office IP to the allowlist and test with an employee whose
   remote-entry box is unchecked

## Next: Phase 3

Time entry — the hourly path first, then salaried.

---

# Phase 3 — Hourly time entry

## Run the migration

In the Supabase SQL Editor, run `supabase/migrations/0007_timecard_logic.sql`.

## What's new

`/dashboard` is now a working timecard.

- **Day grid** for the pay period. Scheduled days are solid; unscheduled days
  are dashed and muted — but still accept entries, since a 4×10 employee
  working Friday is exactly what triggers the holiday election.
- **Multiple entries per day**, each with its own work code. Enter flat hours
  or start/end times (add a separate entry around lunch — no automatic
  deduction).
- **Holiday hours apply automatically** per schedule, and are reduced hour for
  hour by time worked that day.
- **Holiday elections** — hourly employees who work a holiday choose floating
  holiday or double time. Salaried always get floating holiday.
- **4×10 conversion** — working all four Mon–Thu in a Friday-holiday week
  banks the holiday as a floating holiday instead of paying it, preventing
  phantom overtime.
- **Warnings, not blocks** — scheduled days with no time and pending holiday
  choices are flagged, but approval is never prevented.
- **Weekly totals** with Sunday–Saturday boundaries. Split weeks are marked;
  their OT settles in Phase 4.
- **Network restriction** enforced on every write for employees entering their
  own time.
- **Period picker** defaults to the period containing today.

## Testing the holiday logic

Good Friday 2026 is **April 3** — a Friday, so it exercises both the 4×9+4
split and the 4×10 conversion. Set the period picker to 3/26–4/10 and try:

**4×10 employee**
- Enter 10h on Mon, Tue, Wed → Friday shows 10h holiday, week totals 40
- Add 10h Thursday → holiday converts to floating, blue notice appears
- Add 10h Friday → election prompt for the Friday hours

**4×9+4 employee**
- Thursday 4/2 shows 5h holiday, Friday 4/3 shows 4h
- Enter 4h worked Thursday → week totals 40 with no OT

**Salaried**
- Enter any hours on a holiday → floating holiday accrues automatically,
  holiday pay reduces by the same amount

## Still to come

- Phase 4: OT calculator with split-week lookback, floating holiday ledger
  posting at approval
- Phase 5: supervisor approvals, audit view, export
- Salaried entry path (confirm-remaining sweep)

## Note on module boundaries

`lib/timecard-calc.ts` holds pure calculations (totals, weekly OT) with no
server imports, so client components can use them. `lib/timecard.ts` holds
the Supabase queries and imports `next/headers` — server-only. Keep new
calculation helpers in `timecard-calc.ts` or client components will fail to
compile.

---

# Phase 4 — Overtime and supervisor approvals

## Run the migrations

In the Supabase SQL Editor, in order:

1. `supabase/migrations/0008_phase3_fixes.sql` — captures the three fixes you
   ran by hand during Phase 3, so the files match the database. Safe to re-run.
2. `supabase/migrations/0009_overtime.sql` — OT settlement, floating holiday
   ledger, supervisor approval.

## What's new

**`/approvals`** — the supervisor queue. Three sections: waiting for approval,
not yet employee-approved (approvable anyway), and already approved. Bulk
approve via checkboxes, or one at a time. Click any name to open their card.

**Overtime settlement** with split-week lookback. For each Sunday–Saturday
week, the system totals hours across every period that touches it, subtracts
what was already paid, and splits the remainder at the 40-hour line. Verified
against both worked examples:

- 20h in period A, 25h more in period B (45 total) → B pays 20 regular + 5 OT
- 42h in period A (40 reg + 2 OT), 30h more in B (72 total) → B pays 30 OT

**Floating holidays post at supervisor approval**, not before — an open card
shouldn't move balances. Two sources: hours worked on a holiday (salaried
always, hourly when elected), and 4×10 Friday conversions.

**Withdrawing approval reverses the ledger** — both the workweek rows and the
floating holiday postings — so a correction doesn't leave orphaned balances.

**The timecard now shows real OT**, calculated server-side with the full
cross-period picture rather than the earlier client-side approximation. Split
weeks say whether OT settles in this period or the next.

## Testing overtime

The 3/26–4/10 semi-monthly period ends Friday 4/10, so the week of 4/5–4/11
straddles the boundary — ideal for testing arrears.

1. Enter enough hours in 3/26–4/10 to exceed 40 in a single week → OT appears
2. Enter hours in the week that crosses into 4/11–4/25 → the first period shows
   "continues next period," the second settles the OT
3. Approve as supervisor, then check `workweek_ledger` — one row per week per
   period, showing exactly what each paid

## Still to come

- Phase 5: export, audit view, year-end conversion report
- Salaried entry path (confirm-remaining sweep)

---

# Salaried entry path

## Run the migration

`supabase/migrations/0010_salaried.sql` in the SQL Editor.

## How it works

Salaried employees get a different card entirely — routed automatically by
employee type. They are paid a flat 80 hours per period, so the card collects
**exceptions**, not hours.

Each scheduled day is in one of three states:

- **Pending** (amber) — needs attention. Nothing recorded, not yet confirmed.
- **Confirmed** (green) — employee checked "worked as scheduled."
- **Exception** (white) — has time off or holiday work recorded explicitly.

**"Confirm remaining days"** sweeps every pending day at once — the one-click
path for a period with no exceptions. Days already carrying time off or holiday
work are skipped, so the sweep can't paper over something handled deliberately.

Confirmation is stored on `timecard_days`, not as an entry. The export emits the
flat 80 plus time off; confirmation is the audit trail showing the employee
actively reviewed each day rather than approving an empty card by inertia.

**Partial days** work as expected: record 4h vacation on a 9h day, then confirm
the rest as worked.

**Holiday work** uses the same rules as hourly — hours beyond the expected
portion reduce holiday pay and bank floating holiday time. Salaried never get
the double-time choice; it's always floating holiday.

## Testing

Switch an employee to salaried, or use your own record:

```sql
select change_assignment(
  (select id from employees where employee_number = '446'),
  '2026-07-01', 'semi_monthly', 'salaried', '4x9+4', 'ITXAWAT', true
);
```

Then reload `/dashboard`. Try: confirming one day individually, sweeping the
rest, adding a half-day of vacation, and recording hours on Good Friday (4/3).

---

# Phase 4.5 — Employee dashboard and balances

## Run the migration

`supabase/migrations/0011_dashboard_balances.sql`

## Routing change

`/dashboard` is now the **home page** — the portal front door. The timecard
moved to `/timecard`. Signing in lands on the dashboard, which shows the
current period status and an "Enter my time" button.

## The dashboard shows

- **Current pay period** — dates, approval status, count of items needing
  attention, and a link straight to the card
- **Vacation, sick, and floating holiday balances**. Vacation and sick come
  from payroll imports; the card shows the imported figure less any time off
  entered here since the snapshot date, so the number reflects what is actually
  available rather than a stale import.
- **Year-end projection** — how much vacation is above the carryover limit and
  what happens to it, with the full two-step conversion shown

## Year-end projection

Uses the rules we worked out, verified against every case:

- **Step 1 (end of 3/31)** — vacation over 160 converts to sick 1:1 up to the
  480 sick cap; anything still over is forfeited. Sick already full means all
  excess vacation is forfeited outright.
- **Step 2 (4/1)** — sick over 480 converts to vacation at 3:1, applied after
  the truncation, so vacation can exceed 160 on April 1.

The projection closes the gap payroll can't see: the imported snapshot is stale
for 3/26–3/31 because that period hasn't processed. This app owns those entries,
so `projected = snapshot − time off entered since the snapshot date`.

**One thing to confirm:** the 3:1 conversion produces whole vacation hours only.
31 sick hours over the cap yields 10 vacation hours (30 consumed), with 1 hour
remaining in sick. Check that matches how payroll handles the remainder.

## Balances (`/admin/balances`)

**Import** — paste CSV as `employee_number, vacation, sick`. A header row is
detected and skipped. Blank cells are skipped rather than zeroed, so a
vacation-only file won't wipe sick balances. Re-importing the same date corrects
rather than duplicates.

**Single correction** — one employee, one bank, with an optional note. Tagged
`manual` in the list so corrections are distinguishable from imports.

## Testing

Import a few balances, then check the dashboard. To see the year-end warning,
give yourself vacation above 160:

```
446,200,540
```

That's the both-banks-over case: 40h vacation forfeited on 3/31 (sick already
full), 60h sick converts to 20h vacation on 4/1, ending at 180 vacation / 480
sick.

---

# Year-end conversion report

## Run the migration

`supabase/migrations/0012_year_end_report.sql`

Also fixes the 3:1 conversion to allow partial hours — balances are not
quarter-hour rounded, so 61h over the cap yields 20.33h vacation and consumes
the full 61h.

## `/admin/year-end` — two views

**Monitor** — the monthly view. Who is trending over the vacation limit, by how
much, and how much would be lost. Run this from January onward; employees see
their own projection on their dashboard, so this is for tracking rather than
notification.

**Payroll entry** — the 3/31 and 4/1 view. One row per employee needing an
adjustment, with a CSV export.

## The two numbers

The report shows both, and they are not the same:

- **Employee ends** — what the employee actually has after conversion
- **Enter vac / Enter sick** — what payroll types into the payroll system

They differ when time off is entered here that payroll has not processed. The
3/26–4/10 period is still open on 4/1, so payroll will subtract those hours when
it runs. The entry value pre-adds them.

Worked example, verified:

```
snapshot 3/31        180 vacation
used 3/26            10 hours (entered here, not yet processed)
true balance         170
cap                  160  ->  10h over, forfeited (sick full)
employee ends at     160
PAYROLL ENTERS       170   (160 + 10 pending)
period runs, -10h -> 160   correct
```

Entering 160 instead would land the employee at 150 — the pending hours
subtracted twice. The blue notice appears whenever any employee has pending
hours, so this is visible rather than assumed.

## Saving a run

"Save run" writes the current figures to `year_end_runs` / `year_end_results`.
Payroll keys from the screen or CSV; the saved run is the record of what the
numbers were at that moment, which matters if anything is questioned later.

---

# Audit view

## Run the migration

`supabase/migrations/0013_audit_view.sql`

## Two places

**On every timecard** — a "Change history" section below the card. Shows who
changed what, from what to what, and when. Visible to the employee, their
supervisors, and payroll admins. This is how an employee finds out a supervisor
edited their time: it's on the card, where they'd look, rather than a separate
notification.

**`/admin/audit`** — searchable across everyone. Filter by date range, employee,
or who made the change. Payroll admin only.

## What it shows

Four things, per your spec: **who**, **what it was**, **what it is now**,
**when**. The raw log stores full before/after JSON; the view translates that
into readable lines:

```
4/9 2:15pm   Karen Larsell   changed   Tue 4/7   WHPEDAV   8h → 9h
```

Automatic changes are hidden by default — holiday hours recalculate whenever
worked hours change, so one employee edit can cascade into several log rows.
The "Show automatic changes" toggle reveals them when you need to understand
why a holiday figure moved.

Changes made by someone other than the card's owner are tagged, and the count
appears above the table.

## Retention

Manual purge on a rolling two-calendar-year window: the current year and the
prior full year are kept. Running in 2027 removes anything before 1/1/2026.

The purge screen shows how many records are eligible before you commit, and the
confirmation states plainly that only change history is removed — timecards,
hours, overtime, balances, and year-end results are never touched.

---

# Printable timecards

## Run the migration

`supabase/migrations/0014_print.sql`

## Where

- **`/approvals`** → "Print approved" prints every supervisor-approved card for
  the period, one per page, in a single document.
- **Any timecard** → "Print" link in the header prints just that card.

Both open in a new tab with a Print button. Choose "Save as PDF" as the
destination in the browser's print dialog.

## Layout

Matches the existing payroll report:

- Header with employee number, name, date range, overtime period, print
  timestamp, and work codes used
- Detail lines with the date printed once per day and work codes stacked
  beneath when a day has several
- Prior-period rows from the same workweek marked with `*` and excluded from
  period totals — they appear only so the overtime arithmetic is visible
- Workweek block (Sunday–Saturday) with total, regular, and overtime per week
- Time-off lines with the three payroll buckets: Vacation, Sick, Other
- Footnote explaining the asterisk, shown only when prior rows exist

**Salaried cards** print differently, matching the sample: one line for the
default work code at 80 hours, "Default Regular Hours 80.00", and Total Hours
80.00 regardless of time off. Time off is listed and totalled separately since
it does not add to the 80. No punch columns, no workweek block.

## Approval lines

Two signature lines, each with the name and approval timestamp:

```
Employee:       BRAXTON JESSUP        Date: 04/12/26 23:32:15
Authorized By:  STEVE LUITEN          Date: 04/13/26 07:41:33
```

Names fill in from the approval records; a card approved by neither prints blank
lines for signing by hand.

## Notes

- **Family Care exports under Sick**, matching the bucket configuration. The
  separate "FAMILY CAR Hours" line in the current system is a bug and is not
  reproduced.
- Punch times print as `00:00 AM` when hours were entered directly rather than
  as clock times, matching current behaviour.

## Holiday notes on printed cards

Migration: `supabase/migrations/0015_print_notes.sql`

A boxed NOTE section prints below the footnote whenever a holiday needs the
processor's attention. Three cases:

**Double time** — names the work code and hours to pay at double rate. The
detail table shows two lines under the same code, so the note says which:

```
NOTE: 04/03/2026 Good Friday — worked 2 hrs, elected DOUBLE TIME.
      2 hrs under WHPEHAR to be paid at double rate.
```

**Floating holiday** — informational; the app already banked the hours, but the
choice is recorded so the processor knows it was deliberate.

**4×10 conversion** — explains why holiday hours are absent, which would
otherwise look like an error against a prior period:

```
NOTE: 04/03/2026 Good Friday — worked 4 days this week, holiday converted
      to floating holiday (10 hrs banked).
```

Salaried cards say "floating holiday added" rather than "elected," since
salaried employees are never offered the choice.

---

# Pay period management

## Run the migration

`supabase/migrations/0016_pay_periods.sql`

## `/admin/pay-periods`

**Semi-monthly** — a year button. The dates never vary (11th–25th, 26th–10th),
so 24 periods are created at once. The year field pre-fills with the first year
not already covered, and badges show which years are on file and whether any are
incomplete.

**Bi-weekly** — a season generator. No fixed anchor, since the season starts
when the first bi-weekly employee starts. Enter the Sunday and how many periods.

The Sunday requirement is enforced at both layers: the field highlights and the
button disables when the date isn't a Sunday, with a one-click "use the next
Sunday" fix, and the database rejects it regardless. An off-by-one anchor would
misalign every overtime week for the season, so it's worth being strict.

Seasons already on file are listed, grouped by contiguous runs — a gap of more
than one day between periods starts a new season.

## Deletion

Blocked once a period has any timecard. The list shows timecard and entry counts
per period; periods in use show "in use" instead of a delete link, and the
database raises an error naming the count if anything tries anyway.

## Future periods now visible

The picker on the timecard and approvals screens previously showed only the
current period and earlier. It now includes the next two upcoming periods, so
time can be entered in advance — scheduled vacation, for instance — and a
period that has just been generated is reachable before today falls inside it.

---

# Testing fixes

## Run the migration

`supabase/migrations/0017_testing_fixes.sql`

## What changed

**1. Approvals links keep the period.** Clicking an employee's name on
`/approvals` now opens their card for the period you were looking at, not the
current one.

**2. Work codes are editable.** An Edit link on each row lets you fix a typo in
the code or description.

**3. Time entries are editable.** An Edit link on each entry opens it inline —
hours, work code, start/end times, and note — instead of remove-and-re-add.
Entering start and end times recalculates the hours, same as when adding.

**4. Remote-entry checkbox is editable.** A Details panel on the employee page
covers name, role, remote entry, and shuttle eligibility. Payroll type,
employee type, and schedule stay on the assignment history, since those are
effective-dated.

**5. Floating holiday has its own code.** `FLOATHOL` is what an employee selects
to spend banked hours, and the picker shows how many are available. The database
rejects anything over the balance, counting both the ledger and hours already
entered on open cards — so the same hours can't be spent twice.

`HOL` is now system-generated only and has been removed from employee pickers.
The migration gives `FLOATHOL` to everyone who previously had `HOL` allowed.

Both export under the Other bucket, which is all the payroll system reads.

**6. 24-hour daily cap.** A database trigger blocks any save that would push a
day past 24 hours, counting worked and time-off hours together. This blocks
rather than warns, since the result is never legitimate.

**7. Time off across a date range.** A button above the day grid takes a date
range and a code, then previews exactly what it will do before applying:

```
Will apply 27 hours across 3 days: Mon 7/20 (9h), Tue 7/21 (9h), Wed 7/22 (9h)
Skipping Fri 7/24 — not scheduled
```

Days that aren't scheduled, already have time, or carry a holiday are skipped.

---

# Accrual rates

## Run the migration

`supabase/migrations/0018_accrual_rates.sql`

## The model

**The payroll system remains the source of truth**, for rates as well as
balances. Rates are entered here manually, copied from payroll — this app never
computes a tier, so it can never quietly disagree with payroll about what
someone earns.

Rates are used for exactly two things:

1. **Capping entry** — an employee may use their imported balance plus accrual
   earned since, and no more
2. **Projecting the 3/31 balance** — "if you take no more time off, here's where
   you land"

Neither writes an accrued balance as truth. The next import corrects any drift.

## Effective-dated

Rates live on the employee page under "Accrual rates", each with an effective
date. When someone crosses an anniversary, add a row rather than editing the old
one — the projection then applies the old rate to periods before the change and
the new rate after, which matters for anyone crossing a tier before 3/31.

## Timing

A period's accrual counts once the period has **started**. Payroll credits it at
processing, so an employee working through the current period has earned it but
payroll hasn't recorded it yet — that gap is exactly what this closes.

Worked through with your example: 50h imported on 7/11, accruing 5.00/period.
During the 7/11–7/25 period they may use **55h**. On 7/26 payroll processes and
credits the 5; a fresh import shows 55, the 7/26 period has started, and
available becomes 60.

## Cap enforcement

The daily-cap trigger now also checks banks. Entering more vacation or sick than
available is rejected with the available figure named:

```
Only 55.00 vacation hours are available (balance plus accrual earned)
```

Employees with **no rate on file** fall back to the imported balance with no
accrual added — the safe direction to be wrong in. The year-end report flags how
many employees are in that state.

## Dashboard

Balance cards now show the usable figure with the arithmetic beneath:

```
55 hours
50 on file as of 7/11/26
plus 5h accrued since
```

The year-end projection adds an "Accrues by 3/31 if no time is taken" line, and
says explicitly when a projection excludes accrual because no rate is on file.
