"""Verify the SQL calendar logic by porting it to Python and checking outputs."""
from datetime import date, timedelta

def nth_weekday(year, month, dow, n):
    """dow: 0=Sunday..6=Saturday (Postgres convention)"""
    d = date(year, month, 1)
    first_dow = (d.weekday() + 1) % 7  # python Mon=0 -> pg Sun=0
    offset = ((dow - first_dow + 7) % 7) + (n - 1) * 7
    return d + timedelta(days=offset)

def last_weekday(year, month, dow):
    if month == 12:
        d = date(year, 12, 31)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    last_dow = (d.weekday() + 1) % 7
    return d - timedelta(days=(last_dow - dow + 7) % 7)

def easter_sunday(y):
    a = y % 19; b = y // 100; c = y % 100
    d = b // 4; e = b % 4; f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19*a + b - d - g + 15) % 30
    i = c // 4; k = c % 4
    l = (32 + 2*e + 2*i - h - k) % 7
    m = (a + 11*h + 22*l) // 451
    mth = (h + l - 7*m + 114) // 31
    dy = ((h + l - 7*m + 114) % 31) + 1
    return date(y, mth, dy)

def observed(d):
    pg_dow = (d.weekday() + 1) % 7
    if pg_dow == 6:   # Saturday
        return d - timedelta(days=1)
    if pg_dow == 0:   # Sunday
        return d + timedelta(days=1)
    return d

def holidays(year):
    return [
        ("New Year's Day",  date(year, 1, 1)),
        ("MLK Day",         nth_weekday(year, 1, 1, 3)),
        ("Presidents' Day", nth_weekday(year, 2, 1, 3)),
        ("Good Friday",     easter_sunday(year) - timedelta(days=2)),
        ("Memorial Day",    last_weekday(year, 5, 1)),
        ("Independence Day",date(year, 7, 4)),
        ("Labor Day",       nth_weekday(year, 9, 1, 1)),
        ("Thanksgiving",    nth_weekday(year, 11, 4, 4)),
        ("Christmas Day",   date(year, 12, 25)),
    ]

DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
def dname(d): return DAYS[(d.weekday() + 1) % 7]

for year in (2026, 2027):
    print(f"=== {year} ===")
    for name, actual in holidays(year):
        obs = observed(actual)
        shifted = " <-- SHIFTED" if obs != actual else ""
        flag = ""
        if dname(obs) == "Fri":
            flag = "  [Fri: 4x9 splits 5Thu/4Fri; 4x10 conversion rule applies]"
        print(f"  {name:<18} actual {actual} {dname(actual):<3} -> observed {obs} {dname(obs):<3}{shifted}{flag}")
    print()

# Known-good checks against real calendar dates
checks = [
    ("MLK 2026",          nth_weekday(2026,1,1,3),  date(2026,1,19)),
    ("Presidents 2026",   nth_weekday(2026,2,1,3),  date(2026,2,16)),
    ("Memorial 2026",     last_weekday(2026,5,1),   date(2026,5,25)),
    ("Labor 2026",        nth_weekday(2026,9,1,1),  date(2026,9,7)),
    ("Thanksgiving 2026", nth_weekday(2026,11,4,4), date(2026,11,26)),
    ("Easter 2026",       easter_sunday(2026),      date(2026,4,5)),
    ("Easter 2027",       easter_sunday(2027),      date(2027,3,28)),
]
print("=== assertions ===")
ok = True
for label, got, want in checks:
    status = "OK " if got == want else "FAIL"
    if got != want: ok = False
    print(f"  {status} {label:<20} got {got}  want {want}")

# Semi-monthly periods
def semi_monthly(year):
    out = []
    for m in range(1, 13):
        out.append((date(year, m, 11), date(year, m, 25)))
        s = date(year, m, 26)
        nm, ny = (m + 1, year) if m < 12 else (1, year + 1)
        out.append((s, date(ny, nm, 10)))
    return sorted(out)

print("\n=== semi-monthly 2026 (first 6) ===")
for s, e in semi_monthly(2026)[:6]:
    print(f"  {s} {dname(s):<3} -> {e} {dname(e):<3}")

print("\n=== bi-weekly 2026 season (first 5 from 5/3) ===")
start = date(2026,5,3)
assert dname(start) == "Sun", "bi-weekly must start Sunday"
for i in range(5):
    s = start + timedelta(days=14*i)
    e = s + timedelta(days=13)
    print(f"  {s} {dname(s):<3} -> {e} {dname(e):<3}")

print("\nAll assertions passed" if ok else "\nFAILURES PRESENT")
