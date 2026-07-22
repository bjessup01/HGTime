"""
Year-end report: the number payroll ENTERS vs the number the employee ENDS at.

The gap: the 3/26-4/10 pay period has not processed when the adjustment is
keyed in on 4/1. Payroll will subtract the 3/26-3/31 time off when that
period runs. So the entered figure must PRE-ADD those pending hours,
otherwise they get subtracted twice.

    entry value = post-conversion target + pending hours

Braxton's example:
    snapshot 3/31   180 vacation
    used 3/26        10 hours (entered here, not yet processed)
    true balance    170
    cap             160  -> 10h over, converts or forfeits
    target          160
    ENTER           170   (160 + 10)
    payroll runs, subtracts 10 -> lands at 160
"""

VAC_CAP = 160.0
SICK_CAP = 480.0
DIVISOR = 3.0


def year_end(snapshot_vac, snapshot_sick, pending_vac=0.0, pending_sick=0.0):
    # What the balance really is once pending time off is accounted for
    proj_vac = max(snapshot_vac - pending_vac, 0)
    proj_sick = max(snapshot_sick - pending_sick, 0)

    # --- Step 1: end of 3/31 ---
    vac_over = max(proj_vac - VAC_CAP, 0)
    sick_room = max(SICK_CAP - proj_sick, 0)
    vac_to_sick = min(vac_over, sick_room)
    vac_forfeited = max(vac_over - vac_to_sick, 0)

    vac_after = proj_vac - vac_over
    sick_after = proj_sick + vac_to_sick

    # --- Step 2: 4/1 ---
    sick_over = max(sick_after - SICK_CAP, 0)
    sick_to_vac = round(sick_over / DIVISOR, 2)
    sick_consumed = sick_over

    final_vac = vac_after + sick_to_vac
    final_sick = sick_after - sick_consumed

    # --- what payroll types in ---
    # Pre-add pending hours; payroll subtracts them when the period runs.
    entry_vac = round(final_vac + pending_vac, 2)
    entry_sick = round(final_sick + pending_sick, 2)

    # An entry is only needed if something actually changed
    needs_vac_entry = abs(final_vac - proj_vac) > 0.001
    needs_sick_entry = abs(final_sick - proj_sick) > 0.001

    return {
        "proj_vac": proj_vac, "proj_sick": proj_sick,
        "vac_over": vac_over, "vac_to_sick": vac_to_sick,
        "vac_forfeited": vac_forfeited,
        "sick_over": sick_over, "sick_to_vac": sick_to_vac,
        "final_vac": final_vac, "final_sick": final_sick,
        "entry_vac": entry_vac, "entry_sick": entry_sick,
        "needs_vac_entry": needs_vac_entry,
        "needs_sick_entry": needs_sick_entry,
    }


def show(label, sv, ss, pv=0.0, ps=0.0, *, expect=None):
    r = year_end(sv, ss, pv, ps)
    print(f"\n{label}")
    print(f"  snapshot        vacation {sv:g}    sick {ss:g}")
    if pv or ps:
        print(f"  pending (3/26+) vacation {pv:g}    sick {ps:g}")
    print(f"  true 3/31       vacation {r['proj_vac']:g}    sick {r['proj_sick']:g}")
    if r["vac_over"]:
        print(f"  step 1          {r['vac_over']:g}h over -> "
              f"{r['vac_to_sick']:g}h to sick, {r['vac_forfeited']:g}h forfeited")
    if r["sick_over"]:
        print(f"  step 2          {r['sick_over']:g}h sick over -> "
              f"{r['sick_to_vac']:g}h vacation")
    print(f"  employee ends   vacation {r['final_vac']:g}    sick {r['final_sick']:g}")
    print(f"  PAYROLL ENTERS  vacation "
          f"{r['entry_vac']:g}{'' if r['needs_vac_entry'] else '  (no change needed)'}"
          f"    sick "
          f"{r['entry_sick']:g}{'' if r['needs_sick_entry'] else '  (no change needed)'}")

    if expect:
        for k, v in expect.items():
            assert abs(r[k] - v) < 0.011, f"    FAIL {k}: got {r[k]}, want {v}"
        print("  OK")
    return r


print("=" * 72)
print("BRAXTON'S EXAMPLE")
print("=" * 72)

show("180 vacation, 480 sick, 10h vacation used 3/26",
     180, 480, pv=10,
     expect={"proj_vac": 170, "vac_over": 10, "vac_forfeited": 10,
      "final_vac": 160, "entry_vac": 170})

print("\n  Payroll enters 170. Period processes, subtracts the 10h used.")
print("  Employee lands at 160. Correct.")

print()
print("=" * 72)
print("WITHOUT THE PRE-ADD — what would go wrong")
print("=" * 72)
r = year_end(180, 480, pending_vac=10)
print(f"\n  If payroll entered the target ({r['final_vac']:g}) instead of "
      f"{r['entry_vac']:g}:")
print(f"    entered:                  {r['final_vac']:g}")
print(f"    period processes, -10h:   {r['final_vac'] - 10:g}")
print(f"    employee ends at:         {r['final_vac'] - 10:g}  <-- 10h short")
print("  The pending hours get subtracted twice. This is the bug the")
print("  pre-add prevents.")

print()
print("=" * 72)
print("NO PENDING HOURS — entry equals target")
print("=" * 72)

show("200 vacation, 400 sick, nothing pending",
     200, 400,
     expect={"proj_vac": 200, "vac_to_sick": 40, "final_vac": 160,
      "entry_vac": 160, "final_sick": 440, "entry_sick": 440})

print()
print("=" * 72)
print("PENDING ON BOTH BANKS")
print("=" * 72)

show("200 vacation, 540 sick, 8h vacation + 4h sick used 3/26-3/31",
     200, 540, pv=8, ps=4)

r = year_end(200, 540, 8, 4)
print(f"\n  Check: entry {r['entry_vac']:g} - 8 pending = {r['entry_vac'] - 8:g} "
      f"= final {r['final_vac']:g}")
assert abs((r["entry_vac"] - 8) - r["final_vac"]) < 0.011
print(f"  Check: entry {r['entry_sick']:g} - 4 pending = {r['entry_sick'] - 4:g} "
      f"= final {r['final_sick']:g}")
assert abs((r["entry_sick"] - 4) - r["final_sick"]) < 0.011
print("  OK — both banks reconcile")

print()
print("=" * 72)
print("NOTHING CONVERTS — no entry needed even with pending hours")
print("=" * 72)

r = show("120 vacation, 400 sick, 8h vacation used",
         120, 400, pv=8)
assert not r["needs_vac_entry"], "should need no entry"
assert not r["needs_sick_entry"], "should need no entry"
print("\n  Nothing crossed a cap, so payroll enters nothing. The pending")
print("  hours process normally with the period.")

print()
print("=" * 72)
print("PARTIAL-HOUR CONVERSION (balances are not quarter-hour rounded)")
print("=" * 72)

show("100 vacation, 541 sick", 100, 541,
     expect={"sick_over": 61, "sick_to_vac": 20.33, "final_sick": 480})

print("\nAll assertions passed.")
