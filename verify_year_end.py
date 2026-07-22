"""
Fiscal year-end conversion (3/31 -> 4/1), mirroring the SQL in 0011.

Rules as stated:
  Caps: vacation 160, sick 480.
  Step 1 (end of 3/31): vacation over 160 converts to sick 1:1, filling
    sick up to 480. Anything still over 160 is FORFEITED. If sick is
    already at 480 there is no room, so all excess vacation is forfeited.
  Step 2 (4/1): sick over 480 converts to vacation at 3:1 (3 sick yields
    1 vacation). Applied AFTER the truncation, so vacation can exceed
    160 on 4/1.
"""

VAC_CAP = 160.0
SICK_CAP = 480.0
SICK_TO_VAC_DIVISOR = 3.0


def convert(proj_vac, proj_sick):
    # ---- Step 1: end of 3/31 ----
    vac_over = max(proj_vac - VAC_CAP, 0)
    sick_room = max(SICK_CAP - proj_sick, 0)
    vac_to_sick = min(vac_over, sick_room)          # 1:1
    vac_forfeited = max(vac_over - vac_to_sick, 0)

    vac_after = proj_vac - vac_over                 # capped at 160
    sick_after = proj_sick + vac_to_sick

    # ---- Step 2: 4/1 ----
    sick_over = max(sick_after - SICK_CAP, 0)
    sick_to_vac = sick_over // SICK_TO_VAC_DIVISOR  # whole hours only
    sick_consumed = sick_to_vac * SICK_TO_VAC_DIVISOR

    return {
        "vac_over": vac_over,
        "vac_to_sick": vac_to_sick,
        "vac_forfeited": vac_forfeited,
        "sick_over": sick_over,
        "sick_to_vac": sick_to_vac,
        "sick_consumed": sick_consumed,
        "final_vac": vac_after + sick_to_vac,
        "final_sick": sick_after - sick_consumed,
        "end_of_331_vac": vac_after,
        "end_of_331_sick": sick_after,
    }


def show(label, vac, sick, expect=None):
    r = convert(vac, sick)
    print(f"\n{label}")
    print(f"  projected 3/31:  vacation {vac:g}   sick {sick:g}")
    if r["vac_over"] > 0:
        print(f"  step 1: {r['vac_over']:g}h vacation over cap")
        print(f"          {r['vac_to_sick']:g}h -> sick (1:1), "
              f"{r['vac_forfeited']:g}h FORFEITED")
    else:
        print(f"  step 1: vacation under cap, nothing happens")
    print(f"  end of 3/31:     vacation {r['end_of_331_vac']:g}   "
          f"sick {r['end_of_331_sick']:g}")
    if r["sick_over"] > 0:
        print(f"  step 2: {r['sick_over']:g}h sick over cap -> "
              f"{r['sick_to_vac']:g}h vacation (3:1, {r['sick_consumed']:g}h consumed)")
    else:
        print(f"  step 2: sick under cap, nothing happens")
    print(f"  on 4/1:          vacation {r['final_vac']:g}   sick {r['final_sick']:g}")

    if expect:
        for k, v in expect.items():
            assert abs(r[k] - v) < 0.001, \
                f"    FAIL {k}: got {r[k]}, want {v}"
        print("  OK")
    return r


print("=" * 68)
print("YEAR-END CONVERSION CASES")
print("=" * 68)

show("Under both caps — nothing happens",
     120, 400,
     {"vac_over": 0, "vac_to_sick": 0, "vac_forfeited": 0,
      "final_vac": 120, "final_sick": 400})

show("Vacation over, sick has room — converts 1:1",
     200, 400,
     {"vac_over": 40, "vac_to_sick": 40, "vac_forfeited": 0,
      "final_vac": 160, "final_sick": 440})

show("Vacation over, sick partially full — converts then forfeits",
     200, 460,
     {"vac_over": 40, "vac_to_sick": 20, "vac_forfeited": 20,
      "final_vac": 160, "final_sick": 480})

show("Vacation over, sick ALREADY FULL — all excess forfeited",
     200, 480,
     {"vac_over": 40, "vac_to_sick": 0, "vac_forfeited": 40,
      "final_vac": 160, "final_sick": 480})

show("Sick over cap — converts to vacation 3:1",
     100, 510,
     {"sick_over": 30, "sick_to_vac": 10, "sick_consumed": 30,
      "final_vac": 110, "final_sick": 480})

print()
print("=" * 68)
print("THE CASE BRAXTON CALLED OUT — over on BOTH banks")
print("Excess vacation forfeited on 3/31 (sick already full),")
print("then excess sick converts to new vacation on 4/1.")
print("Vacation can exceed 160 on 4/1 even though it was capped on 3/31.")
print("=" * 68)

r = show("Vacation 200, sick 540",
         200, 540,
         {"vac_over": 40, "vac_to_sick": 0, "vac_forfeited": 40,
          "sick_over": 60, "sick_to_vac": 20})

assert r["end_of_331_vac"] == 160, "must be at or under 160 on 3/31"
assert r["final_vac"] == 180, "can exceed 160 on 4/1"
print(f"\n  Confirmed: 160 at end of 3/31, {r['final_vac']:g} on 4/1")

print()
print("=" * 68)
print("PENDING-HOURS GAP — the 3/26-3/31 problem")
print("=" * 68)
print("""
The imported payroll snapshot is stale for 3/26-3/31 because that pay
period has not processed. This app owns those entries, so:

    projected 3/31 = snapshot - time off entered after the snapshot date

Braxton's example: snapshot shows 488 sick, but 8h was taken 3/26.
""")

snapshot_sick = 488.0
taken_since = 8.0
projected = snapshot_sick - taken_since
print(f"  snapshot:        {snapshot_sick:g}h")
print(f"  taken 3/26-3/31: {taken_since:g}h  (this app knows, payroll does not yet)")
print(f"  projected 3/31:  {projected:g}h")

r = convert(100, projected)
print(f"  -> sick is at the cap exactly, no conversion")
assert projected == 480, "should land exactly at the cap"
assert r["sick_over"] == 0, "no excess"
print("  OK")

print()
print("=" * 68)
print("ROUNDING — 3:1 with a remainder")
print("=" * 68)
for over in (29, 30, 31, 32, 33):
    sick = SICK_CAP + over
    r = convert(100, sick)
    print(f"  {over:>2}h over cap -> {r['sick_to_vac']:g}h vacation "
          f"({r['sick_consumed']:g}h consumed, "
          f"{over - r['sick_consumed']:g}h remainder stays in sick)")

print("\nNote: whole vacation hours only; the remainder stays in the sick bank.")
print("Flag for Braxton — confirm this matches how payroll handles it.")
print("\nAll assertions passed.")
