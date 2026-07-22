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
