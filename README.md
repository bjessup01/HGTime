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
