"""
Model the holiday allocation + conversion rules and check them against
the cases Braxton described. This mirrors the SQL in 0007.
"""
from datetime import date, timedelta

DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
def dow(d): return (d.weekday() + 1) % 7
def dname(d): return DAYS[dow(d)]
def week_start(d): return d - timedelta(days=dow(d))

SCHEDULES = {
    "4x10":  {"days": {1: 10, 2: 10, 3: 10, 4: 10},
              "holiday_hours": 10, "conversion": True,  "fri_split": None},
    "4x9+4": {"days": {1: 9, 2: 9, 3: 9, 4: 9, 5: 4},
              "holiday_hours": 9,  "conversion": False, "fri_split": (5, 4)},
    "5x8":   {"days": {1: 8, 2: 8, 3: 8, 4: 8, 5: 8},
              "holiday_hours": 8,  "conversion": False, "fri_split": None},
}

def allocate_holiday(sched_code, observed):
    """Return {date: hours} the holiday allocates for this schedule."""
    s = SCHEDULES[sched_code]
    if s["fri_split"] and dname(observed) == "Fri":
        thu_h, fri_h = s["fri_split"]
        return {observed - timedelta(days=1): thu_h, observed: fri_h}
    return {observed: s["holiday_hours"]}

def apply_reduction(alloc, worked_by_date):
    """Worked hours reduce holiday hour-for-hour on the same date."""
    out = {}
    for d, h in alloc.items():
        out[d] = max(h - worked_by_date.get(d, 0), 0)
    return out

def conversion_applies(sched_code, observed, worked_by_date):
    """4x10 only: worked all 4 Mon-Thu in the holiday week -> converts."""
    if not SCHEDULES[sched_code]["conversion"]:
        return False, 0, False
    if dname(observed) != "Fri":
        return False, 0, False
    wk = week_start(observed)
    mon_thu = sum(
        1 for d, h in worked_by_date.items()
        if week_start(d) == wk and 1 <= dow(d) <= 4 and h > 0
    )
    fri_worked = worked_by_date.get(observed, 0) > 0
    return mon_thu >= 4, mon_thu, fri_worked

print("=" * 68)
print("HOLIDAY ALLOCATION BY SCHEDULE")
print("=" * 68)

# Good Friday 2026 = Fri Apr 3. Christmas 2026 = Fri Dec 25.
# Memorial Day 2026 = Mon May 25.
for label, observed in [("Good Friday 2026", date(2026,4,3)),
                        ("Memorial Day 2026", date(2026,5,25))]:
    print(f"\n{label} — observed {observed} ({dname(observed)})")
    for code in SCHEDULES:
        alloc = allocate_holiday(code, observed)
        parts = ", ".join(f"{d} {dname(d)}={h}h" for d, h in sorted(alloc.items()))
        print(f"  {code:<6} {parts}  (total {sum(alloc.values())}h)")

print()
print("=" * 68)
print("CASE 1 — salaried works 5h on a 9h holiday")
print("expected: 4h holiday remains, 5h FH banked")
print("=" * 68)
observed = date(2026,5,25)          # Monday
alloc = allocate_holiday("4x9+4", observed)
worked = {observed: 5}
after = apply_reduction(alloc, worked)
fh = sum(worked.get(d, 0) for d in alloc)
print(f"  allocated: {sum(alloc.values())}h")
print(f"  worked:    {worked[observed]}h")
print(f"  remaining: {sum(after.values())}h   FH banked: {fh}h")
assert sum(after.values()) == 4 and fh == 5, "FAIL"
print("  OK")

print()
print("=" * 68)
print("CASE 2 — salaried works 5h on a 5h holiday")
print("expected: holiday fully consumed, 5h FH banked")
print("=" * 68)
alloc2 = {observed: 5}
after2 = apply_reduction(alloc2, {observed: 5})
print(f"  remaining: {sum(after2.values())}h   FH banked: 5h")
assert sum(after2.values()) == 0, "FAIL"
print("  OK")

print()
print("=" * 68)
print("CASE 3 — 4x10 Friday holiday, the three sub-cases")
print("=" * 68)
gf = date(2026,4,3)     # Good Friday, a Friday
mon = gf - timedelta(days=4)

scenarios = [
    ("works 3 of Mon-Thu, not Friday",
     {mon: 10, mon+timedelta(days=1): 10, mon+timedelta(days=2): 10},
     "30 worked + 10 holiday = 40, no OT, no conversion"),
    ("works all 4 Mon-Thu, not Friday",
     {mon: 10, mon+timedelta(days=1): 10, mon+timedelta(days=2): 10, mon+timedelta(days=3): 10},
     "40 worked, holiday CONVERTS to floating, no phantom OT"),
    ("works all 4 Mon-Thu AND Friday",
     {mon: 10, mon+timedelta(days=1): 10, mon+timedelta(days=2): 10,
      mon+timedelta(days=3): 10, gf: 10},
     "50 worked, Friday hours get FH-or-DT election"),
]

for label, worked, expectation in scenarios:
    alloc = allocate_holiday("4x10", gf)
    converts, mon_thu, fri_worked = conversion_applies("4x10", gf, worked)
    after = apply_reduction(alloc, worked)
    total_worked = sum(worked.values())
    holiday_paid = 0 if converts else sum(after.values())
    week_total = total_worked + holiday_paid
    ot = max(week_total - 40, 0)

    print(f"\n  {label}")
    print(f"    Mon-Thu days worked : {mon_thu}")
    print(f"    Friday worked       : {fri_worked}")
    print(f"    converts to FH      : {converts}")
    print(f"    worked hours        : {total_worked}")
    print(f"    holiday paid        : {holiday_paid}")
    print(f"    week total (OT base): {week_total}   OT: {ot}")
    print(f"    expected            : {expectation}")

print()
print("=" * 68)
print("CASE 4 — 4x9+4 Friday holiday splits Thu/Fri")
print("=" * 68)
alloc = allocate_holiday("4x9+4", gf)
thu = gf - timedelta(days=1)
print(f"  Thursday {thu}: {alloc[thu]}h")
print(f"  Friday   {gf}: {alloc[gf]}h")
print(f"  total: {sum(alloc.values())}h (= one 9h workday)")
assert alloc[thu] == 5 and alloc[gf] == 4, "FAIL"
print("  OK")

print()
print("=" * 68)
print("CASE 5 — no phantom OT check across schedules, Friday holiday week")
print("=" * 68)
print("=" * 68)
print("Holiday hours DISPLACE scheduled hours on the same day.")
print("A 4x9+4 employee with a Friday holiday works 4h Thursday (9 - 5 holiday)")
print("and is off Friday entirely (4h holiday covers the whole 4h day).")
print()

for code in SCHEDULES:
    s = SCHEDULES[code]
    alloc = allocate_holiday(code, gf)
    wk = week_start(gf)

    # Expected worked hours = scheduled hours MINUS holiday hours that day.
    worked = {}
    for i in range(7):
        d = wk + timedelta(days=i)
        sched = s["days"].get(dow(d), 0)
        hol = alloc.get(d, 0)
        remaining = max(sched - hol, 0)
        if remaining > 0:
            worked[d] = remaining

    converts, mon_thu, _ = conversion_applies(code, gf, worked)
    holiday_paid = 0 if converts else sum(alloc.values())
    total = sum(worked.values()) + holiday_paid

    detail = "  ".join(
        f"{dname(wk+timedelta(days=i))} {worked.get(wk+timedelta(days=i),0):g}w"
        f"+{alloc.get(wk+timedelta(days=i),0):g}h"
        for i in range(7)
        if worked.get(wk+timedelta(days=i)) or alloc.get(wk+timedelta(days=i))
    )
    print(f"  {code}")
    print(f"    {detail}")
    print(f"    worked {sum(worked.values()):g}h + holiday {holiday_paid:g}h "
          f"= {total:g}h   OT: {max(total-40,0):g}h"
          f"{'   CONVERTED' if converts else ''}")
    assert total == 40, f"{code} should total 40, got {total}"

print()
print("Every schedule totals exactly 40 in a Friday-holiday week. No phantom OT.")
print()
print("All assertions passed.")
