"""Phase 0: can we read Google Flights from where this runs (e.g. a GitHub Actions runner)?"""

import sys
from datetime import date

from pricing import GoogleFlights, Itinerary

ROUTES = [("LAX", "DEN"), ("SNA", "SLC"), ("LAX", "YVR")]

src = GoogleFlights()
ok = 0
for o, d in ROUTES:
    r = src.search(Itinerary(o, d, date(2027, 2, 1), date(2027, 2, 4)))
    q = r.cheapest() if r else None
    if q:
        ok += 1
        print(f"OK   {o}->{d}: ${q.price} {q.airlines} | typical {r.typical_low}-{r.typical_high} | history days {len(r.history)}")
    else:
        print(f"FAIL {o}->{d}")
print(f"{ok}/{len(ROUTES)} routes returned prices")
sys.exit(0 if ok else 1)
