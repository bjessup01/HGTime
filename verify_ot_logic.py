"""
Split-week OT settlement.

Rule (from Braxton's examples):
  For each Sun-Sat workweek, look back at what has already been paid for
  that week in prior periods. Hours owed this period =
      total week hours - regular already paid - OT already paid
  Then split the owed hours into regular vs OT based on where the
  40-hour line falls across the whole week.

Only hours that count toward OT participate: worked hours plus Holiday
(the only time-off code flagged counts_toward_ot). Other time-off codes
are paid but excluded from the OT threshold.
"""

def settle_week(week_total, prior_regular=0.0, prior_ot=0.0, threshold=40.0):
    """
    Returns (regular_this_period, ot_this_period).

    week_total  : all OT-eligible hours for the full Sun-Sat week
    prior_*     : what earlier periods already paid for this same week
    """
    already_paid = prior_regular + prior_ot
    owed = week_total - already_paid
    if owed <= 0:
        return 0.0, 0.0

    # Regular capacity remaining before the week crosses the threshold.
    regular_room = max(threshold - prior_regular, 0.0)
    regular = min(owed, regular_room)
    ot = owed - regular
    return round(regular, 2), round(ot, 2)


print("=" * 70)
print("EXAMPLE 1 — Braxton's first case")
print("4x10 employee. Period A ends Tuesday.")
print("Worked 20h Mon-Tue (period A), then 25h rest of week (period B).")
print("Expected: period B pays 20 regular + 5 OT.")
print("=" * 70)

# Period A: only 20 hours exist at the time it closes, all under 40
a_reg, a_ot = settle_week(week_total=20, prior_regular=0, prior_ot=0)
print(f"\n  Period A: {a_reg} regular, {a_ot} OT")

# Period B: the full week is now visible at 45 hours
b_reg, b_ot = settle_week(week_total=45, prior_regular=a_reg, prior_ot=a_ot)
print(f"  Period B: {b_reg} regular, {b_ot} OT")
print(f"  Week total paid: {a_reg + a_ot + b_reg + b_ot}")

assert (a_reg, a_ot) == (20, 0), f"period A wrong: {a_reg}, {a_ot}"
assert (b_reg, b_ot) == (20, 5), f"period B wrong: {b_reg}, {b_ot}"
assert a_reg + b_reg == 40, "regular should cap at 40 for the week"
print("  OK")


print()
print("=" * 70)
print("EXAMPLE 2 — Braxton's second case")
print("Period A: 42h Sun-Tue -> pays 40 regular + 2 OT immediately.")
print("Period B: 30h more that week. Total 72h.")
print("Expected: 72 - 40 - 2 = 30, all OT (week already past 40).")
print("=" * 70)

a_reg, a_ot = settle_week(week_total=42, prior_regular=0, prior_ot=0)
print(f"\n  Period A: {a_reg} regular, {a_ot} OT")

b_reg, b_ot = settle_week(week_total=72, prior_regular=a_reg, prior_ot=a_ot)
print(f"  Period B: {b_reg} regular, {b_ot} OT")
print(f"  Week total paid: {a_reg + a_ot + b_reg + b_ot}")

assert (a_reg, a_ot) == (40, 2), f"period A wrong: {a_reg}, {a_ot}"
assert (b_reg, b_ot) == (0, 30), f"period B wrong: {b_reg}, {b_ot}"
assert a_reg + a_ot + b_reg + b_ot == 72, "total must equal 72"
print("  OK — matches Braxton's arithmetic exactly")


print()
print("=" * 70)
print("ADDITIONAL CASES")
print("=" * 70)

cases = [
    ("Week entirely within one period, under 40",
     [(32, "only period")], [(32, 0)]),
    ("Week entirely within one period, over 40",
     [(46, "only period")], [(40, 6)]),
    ("Split week, both halves under 40 combined",
     [(16, "period A"), (38, "period B")], [(16, 0), (22, 0)]),
    ("Split week, crosses 40 exactly at boundary",
     [(40, "period A"), (48, "period B")], [(40, 0), (0, 8)]),
    ("Three-way split (unusual, but valid)",
     [(10, "period A"), (35, "period B"), (50, "period C")],
     [(10, 0), (25, 0), (5, 10)]),
]

for label, steps, expected in cases:
    print(f"\n  {label}")
    prior_reg = prior_ot = 0.0
    results = []
    for (running_total, name) in steps:
        reg, ot = settle_week(running_total, prior_reg, prior_ot)
        results.append((reg, ot))
        prior_reg += reg
        prior_ot += ot
        print(f"    {name:<12} total-to-date {running_total:>3}h -> "
              f"{reg:>5} regular, {ot:>4} OT")
    assert results == expected, f"  MISMATCH: got {results}, want {expected}"
    print(f"    week paid {prior_reg + prior_ot}h "
          f"({prior_reg} reg + {prior_ot} OT)")

print()
print("=" * 70)
print("HOLIDAY PARTICIPATION")
print("Holiday is the only time-off code counting toward the 40h threshold.")
print("=" * 70)

# 4x9+4 employee, Friday holiday week: 31 worked + 9 holiday = 40, no OT
worked, holiday, vacation = 31, 9, 0
ot_eligible = worked + holiday
reg, ot = settle_week(ot_eligible)
print(f"\n  4x9+4 Friday-holiday week")
print(f"    worked {worked} + holiday {holiday} = {ot_eligible} OT-eligible")
print(f"    -> {reg} regular, {ot} OT")
assert ot == 0, "should not generate OT"
print("    OK — no phantom OT")

# Same employee takes 8h vacation on top; vacation does NOT count toward OT
worked, holiday, vacation = 31, 9, 8
ot_eligible = worked + holiday
reg, ot = settle_week(ot_eligible)
print(f"\n  Same week plus {vacation}h vacation")
print(f"    OT-eligible stays {ot_eligible} (vacation excluded)")
print(f"    -> {reg} regular, {ot} OT, plus {vacation}h vacation paid separately")
assert ot == 0, "vacation must not push into OT"
print("    OK — vacation excluded from the threshold")

print()
print("All assertions passed.")
