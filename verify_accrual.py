"""
Accrual model.

VACATION - tiered by service from the FULL-TIME hire date. Prior hire
dates are not counted (unlike original_hire_date, which is used for
seniority elsewhere). Tiers step on the anniversary, mid-year.

    hire -> 6 months        0.00 / period   (no accrual)
    6 months -> end year 5  3.33 / period
    year 6 -> end year 14   5.00 / period
    year 15+                6.67 / period

SICK - flat 4.00 / period for full-time hourly and salaried.
Seasonal/part-time/on-call get the state minimum, which this system
does not track.

TIMING - the rate is available when the pay period STARTS. So a
snapshot imported on 7/11 (a period start) already includes that
period's accrual as usable.

    available = snapshot + (periods started since snapshot) x rate
"""

from datetime import date
from dateutil.relativedelta import relativedelta


VACATION_TIERS = [
    # (months of service at or above which this rate applies, rate)
    (12 * 15, 6.67),   # year 15+
    (12 * 6,  5.00),   # year 6 through end of year 14
    (6,       3.33),   # 6 months through end of year 5
    (0,       0.00),   # hire to 6 months
]

SICK_RATE = 4.00


def months_of_service(ft_hire: date, as_of: date) -> int:
    d = relativedelta(as_of, ft_hire)
    return d.years * 12 + d.months


def vacation_rate(ft_hire: date, as_of: date) -> float:
    m = months_of_service(ft_hire, as_of)
    for threshold, rate in VACATION_TIERS:
        if m >= threshold:
            return rate
    return 0.0


print("=" * 70)
print("TIER BOUNDARIES — hired 3/15/2020")
print("=" * 70)
hire = date(2020, 3, 15)

checks = [
    (date(2020, 3, 15), 0.00, "hire date"),
    (date(2020, 9, 14), 0.00, "one day before 6 months"),
    (date(2020, 9, 15), 3.33, "exactly 6 months"),
    (date(2021, 3, 15), 3.33, "1 year"),
    (date(2025, 3, 14), 3.33, "day before 5 years - still in year 5"),
    (date(2025, 3, 15), 3.33, "exactly 5 years - START of year 6"),
    (date(2026, 3, 14), 3.33, "day before 6 years"),
    (date(2026, 3, 15), 5.00, "exactly 6 years"),
    (date(2034, 3, 14), 5.00, "day before 14 years"),
    (date(2034, 3, 15), 5.00, "exactly 14 years - still in year 15"),
    (date(2035, 3, 15), 6.67, "exactly 15 years"),
    (date(2040, 1, 1),  6.67, "well past 15"),
]

for when, expected, label in checks:
    got = vacation_rate(hire, when)
    m = months_of_service(hire, when)
    flag = "OK " if abs(got - expected) < 0.001 else "FAIL"
    print(f"  {flag} {when}  {m:>4} mo  {got:.2f}/period   {label}")
    assert abs(got - expected) < 0.001, f"{label}: got {got}, want {expected}"

print()
print("=" * 70)
print("NOTE ON 'BEGINNING OF 6TH YEAR'")
print("=" * 70)
print("""
Braxton's wording:
    "Beginning of 2nd year to end of 5th year   3.33"
    "Beginning of 6th year to the end of 14th year   5.00"

Read literally, the beginning of the 6th year is the 5-year anniversary
(you begin your 6th year the moment you complete 5). That would put the
5.00 rate at 5 years, not 6.

The table above uses >= 6 years for 5.00 and >= 15 years for 6.67,
matching "end of 5th year" = the 6-year anniversary.

    ---> CONFIRM WITH BRAXTON <---
    Does 5.00/period start at the 5-year anniversary or the 6-year one?
""")

print("=" * 70)
print("BRAXTON'S EXAMPLE — 50h imported 7/11, accrues 5.00/period")
print("=" * 70)


def periods_started(snapshot: date, as_of: date, starts: list) -> int:
    """Semi-monthly periods whose START falls after the snapshot date
    and on or before today. The snapshot's own period is not counted
    again - it is already baked into the imported figure."""
    return sum(1 for s in starts if snapshot < s <= as_of)


# semi-monthly starts: 11th and 26th
starts_2026 = []
for m in range(1, 13):
    starts_2026.append(date(2026, m, 11))
    starts_2026.append(date(2026, m, 26))

snapshot_date = date(2026, 7, 11)
snapshot_hours = 50.0
rate = 5.00

print(f"\n  snapshot {snapshot_hours:g}h on {snapshot_date} (a period start)")
print()
for today in [date(2026, 7, 11), date(2026, 7, 20), date(2026, 7, 26),
              date(2026, 8, 11), date(2026, 8, 26)]:
    n = periods_started(snapshot_date, today, starts_2026)
    avail = snapshot_hours + n * rate
    print(f"  on {today}:  {n} period(s) started since  ->  {avail:g}h available")

avail_at_snapshot = snapshot_hours + periods_started(
    snapshot_date, date(2026, 7, 20), starts_2026) * rate
print(f"\n  Braxton's case: 50h + this period's 5h = 55h")
print(f"  Model gives {avail_at_snapshot:g}h during the 7/11-7/25 period.")

if abs(avail_at_snapshot - 55.0) > 0.001:
    print(f"""
  ---> MISMATCH. The snapshot lands ON a period start (7/11), so that
       period's accrual is already reflected in the imported 50h if
       payroll credited it at period start. But Braxton says they can
       use 55h, meaning the 7/11 period accrual is available ON TOP
       of the imported figure.

       So: count periods whose start is >= the snapshot date, not > .
""")

    def periods_started_inclusive(snapshot, as_of, starts):
        return sum(1 for s in starts if snapshot <= s <= as_of)

    n = periods_started_inclusive(snapshot_date, date(2026, 7, 20), starts_2026)
    print(f"       Inclusive: {n} period(s) -> "
          f"{snapshot_hours + n * rate:g}h  <-- matches Braxton")

print()
print("=" * 70)
print("PROJECTION TO 3/31 — 'if you take no more time off'")
print("=" * 70)
print("""
The year-end projection currently subtracts pending time off from the
snapshot. Adding accrual means it must also ADD every period that will
start between now and 3/31.

    projected 3/31 = snapshot
                   - time off entered since snapshot
                   + accrual for periods starting through 3/31

Tier changes matter here: an employee crossing an anniversary before
3/31 accrues at the old rate up to that date and the new rate after.
""")

fy_end = date(2027, 3, 31)
today = date(2026, 7, 22)

starts_all = []
for y in (2026, 2027):
    for m in range(1, 13):
        starts_all.append(date(y, m, 11))
        starts_all.append(date(y, m, 26))
starts_all.sort()

hire2 = date(2020, 9, 1)   # crosses 6 years on 9/1/2026
future = [s for s in starts_all if snapshot_date <= s <= fy_end]

total = 0.0
transitions = []
for s in future:
    r = vacation_rate(hire2, s)
    if not transitions or transitions[-1][1] != r:
        transitions.append((s, r))
    total += r

print(f"  hired {hire2}, snapshot {snapshot_date}, projecting to {fy_end}")
print(f"  {len(future)} periods start in that window")
print(f"  rate changes:")
for when, r in transitions:
    print(f"      from {when}: {r:.2f}/period")
print(f"  total accrual: {total:.2f}h")

assert any(r == 3.33 for _, r in transitions), "should start at 3.33"
assert any(r == 5.00 for _, r in transitions), "should step to 5.00"
print("\n  OK — tier transition handled mid-projection")

print("\nAll assertions passed.")
