# Powder Fares — Multi-mountain cluster feature: design review and corrected implementation brief

Date: 2026-11-16
Status: Architecture feedback / implementation guidance, NOT a code audit.
Basis: User-supplied proposed plan, plus public external documentation consulted for fast-flights one-way searches, GitHub Actions, and one-way car-rental restrictions. Do not treat examples as validated schedules, driving times, fares, or pass access.

## Verdict

Build this feature. It is differentiated, useful, and consistent with Powder Fares' travel + pass + snow concept. However, do not implement the proposed schema and comparator verbatim: it can compare incompatible ground itineraries, mistake nights for ski days, and overclaim trip savings.

## P0 — Correct before implementation

### 1. Distinguish cluster, itinerary variant, and travel mode

- **Cluster** = destination region and pool of possible resorts.
- **Variant** = feasible itinerary for a specific duration (5 or 7 nights), with an ordered subset of required stops, exact overnight allocation, explicit intended ski-day offsets, and transfer days.
- **Travel mode** = particular incoming/outgoing airport combination plus its *complete* ground route and airport transfers.
- The original `legs` field (only between resorts) is insufficient. Include airport -> first resort and last resort -> selected departure airport, including any return drive to a round-trip hub.
- Never assume an open-jaw and round-trip flight arrangement use identical driving time, feasibility, or lodging nights.
- Verify every drive-minute estimate against an authoritative route source, record checked date, and flag mountain pass/seasonal road uncertainty.

### 2. Ski days are not nights

- Express overnight allocation in nights, pass usage in **actual ski dates**, and snow ratings over those ski dates (or label the different time basis clearly).
- Determine ski-day dates from departure date and variant `ski_day_offsets`. Validate those days against pass product's valid resorts, blackout calendars, and resort-specific day allowance.
- Mark drive-only days and arrival/departure days. Never assume the outbound flight day is a ski day.
- A stop with zero ski days must not receive a grade in overall snow value or satisfy the ≥2 eligible ski-resort criterion.
- Preserve the required distinction between “passes this resort on a route” and “skis this resort.”

### 3. Correct price comparisons

- Call the result `Lowest estimated airfare + board-bag fees`, not `Cheapest trip`.
- Display both flight arrangements (or show unavailable/unpriced state), the flight-only difference, full ground-drive hours for each, and explicit exclusions: car rental, one-way drop fee, fuel, lodging, lift tickets, food, border costs.
- Avoid `save $X` without `on estimated flights + board bag`.
- One-way car rentals may require advance approval, may incur variable fees, or may not be possible for a particular drop-off pair. Mark unsupported rental pairs as uncertain until verified.
- Only compare fares after currency normalization to a common currency. Keep original quoted currency and timestamp.
- Do not combine ancient/expired quotes with fresh quotes as equivalent. Show per-leg quote age and mark stale comparisons.

### 4. Pass eligibility must reflect the actual itinerary

- Include a variant for a given pass only when **at least two distinct actually skied resorts** are supported for that pass product and intended ski dates. A mere network membership should not count if that product lacks resort access, dates are blacked out, or ski-day allowance is exhausted.
- Optional non-pass resorts must be clearly optional (and not silently consume nights, drive time, or snow-ranking weight when deselected). If the route requires that stop, label it mandatory and price its lift access separately or flag it as excluded from totals.
- Use `valid/invalid/unverified` rather than treating missing resort-pass eligibility as success.
- Do not compare nights against pass day limits. Count actual ski days.

## P1 — Important engineering corrections

### Airfare and bag fees

- A one-way booked leg gets a one-way bag charge for its selected airline/fare. For a round trip, calculate the outbound and return separately when the two directions differ. `2 * max(all airline fees)` can overestimate mixed-airline itineraries.
- Preserve trip direction, fare currency, operating/marketing carrier if available, and stops. Confirm baggage fee applicability for code-share/multiple-carrier trips; flag uncertain cases rather than treating them as exact.
- Airfare is a search estimate, not a guaranteed bookable ticket. Keep Google Flights link wording consistent with current site.
- Retaining `Itinerary.ret=None` is viable, but add explicit `kind` and a versioned key namespace. Unit-test existing RT keys and files so old quotes remain readable.
- `fast-flights` publicly documents a `trip="one-way"` request with one `FlightData`; validate the exact installed dependency version and your parser rather than relying on documentation alone.

### Scheduling and flight times

- If the quote lacks arrival/departure times, label ski schedule as provisional. If times are available, filter departures/arrivals that make necessary ground transfers infeasible.
- Consider airport local time zones, date crossing and border crossing delay in the itinerary feasibility check.
- A 5-night cluster should normally involve a small number of ski stops; don't auto-force five different mountains into five nights.

### Snow and ranking

- Do not average letter grades directly. Translate historical snow underlying metrics into a documented numerical scale, then aggregate only planned ski days (optionally by day weight). Show how much of the trip the grade represents.
- Test whether `snow_raw()` percentile calibration is valid for 1-, 2-, 3-, and 4-day stop windows. Reusing a single-trip percentile distribution does not automatically make scores comparable for different durations.
- Treat a drive day as zero planned ski days, not another stop-night score.
- Choose a named metric such as `historical snow quality per airfare dollar` instead of silently reusing the single-mountain formula.
- For v1, ranking by cheapest estimated flight+bag cost and separately displaying weighted historical snow may be clearer than launching a new compound value ranking.

### Scanner budget and operations

- Your stated 554 + 250 = 804 estimated daily searches exceeds the stated capacity of 700. This is not resolved by adding a third GitHub cron trigger if 700 is a *daily provider/rate/operational limit*; a third run only increases available scheduling capacity.
- GitHub documents that standard GitHub-hosted runners are free for public repositories, but that is not unlimited Google Flights request capacity.
- Derive requests as distinct `(origin, direction, airport, date, cabin, query options)` units; reuse results across all clusters. Log actual success, latency, stale age, timeout, retry, CAPTCHA, and error rates.
- Prioritize the flagship cluster and existing single-mountain freshness before scanning all 12 clusters.
- Protect the existing pipeline and parser with isolated OW store paths and tests.

## Suggested data structure (schematic, no verified route data)

```json
{
  "id": "vancouver-bc-interior",
  "region": "British Columbia",
  "resort_pool": ["Cypress Mountain", "Whistler Blackcomb", "Sun Peaks", "SilverStar", "Revelstoke"],
  "variants": [
    {
      "id": "bc-interior-5n-example",
      "nights": 5,
      "stops": [
        {"resort": "Sun Peaks", "night_offsets": [0, 1, 2], "ski_day_offsets": [1, 2], "optional": false},
        {"resort": "SilverStar", "night_offsets": [3, 4], "ski_day_offsets": [4], "optional": false}
      ],
      "transfer_day_offsets": [3],
      "flight_routes": [
        {"kind": "oj", "arrive_airport": "YVR", "depart_airport": "YLW", "ground_route_id": "YVR-SUNPEAKS-SILVERSTAR-YLW"},
        {"kind": "rt", "arrive_airport": "YVR", "depart_airport": "YVR", "ground_route_id": "YVR-SUNPEAKS-SILVERSTAR-YVR"}
      ]
    }
  ]
}
```

**Important:** Resort eligibility, segment drives, feasibility and airport/time assumptions in the schema above are illustrative and unverified. The final schema should link to independently sourced `route_segments` including airport transfers and source timestamps. Don't copy the example into production unchanged.

## Recommended MVP

1. Build **one flagship Vancouver → BC Interior cluster**, using 5-night and 7-night curated variants that fit realistically.
2. Add **two simple same-hub clusters**, for example Wasatch and Colorado I-70, so you test round-trip clusters without the entire complexity of open-jaw travel.
3. First add deterministic local price and itinerary tests using fixture quotes before running more live scans.
4. Run `scan.py --dry-run`; verify actual per-day request demand and freshness. Backfill shared OW legs gradually with strict search budgets.
5. Ship read-only cluster comparisons with a compact route timeline showing: trip dates; stop order; intended ski days; pass validity; historical snow; total drive; airfare+bags; unknown costs.
6. Do not make Planner integration, live car rental quotations, or stop customization part of v1.
7. Expand the catalog to 12 clusters only after demonstrating viable 5/7-night schedules and scanner stability.

## Tests to add to the submitted plan

- `sum(all overnight offsets) == nights`; no duplicate or unallocated nights; travel and ski-day offsets within window.
- A stop with 2 overnight nights but 1 planned ski day uses only 1 pass day; transfer-only stops use zero.
- Two resort stops on a network but only one pass-valid on actual dates => cluster fails ≥2 eligible stop filter.
- An optional non-pass stop omitted from itinerary doesn't count toward snow, pass criteria, or route driving.
- Round-trip ground path includes drive back to hub; open-jaw ground path includes airport-to-first and last-to-airport legs.
- Reject or flag infeasible flight arrival / pickup / driving / departure schedules; annotate unknown timings.
- Mixed airline round trip uses the correct per-direction baggage costs, not 2× a global maximum.
- Differing OW fare currencies are normalized before comparing totals; original quote provenance retained.
- Missing, stale, or failed OW leg => no invented candidate total; display alternative where available.
- Airline exclusion removes invalid leg choices, not just preferred carrier names.
- Snow aggregate weights actual planned ski days, not raw nights or letter-grade averages; test windows of differing length.
- Running scanner with 12 clusters does not multiply identical one-way search units; print unique unit counts and observed requests.
- Runtime rendering/mobile screens clearly distinguish flight-only savings from unknown ground costs.

## Suggested UI copy

- Primary: `Estimated flights + board bag: $X`
- Comparator: `Open-jaw flights are $Y cheaper than a return flight into YVR` (only if verified by comparable cached quotes)
- Ground travel: `Estimated driving: Z hours` for **that candidate's entire** ground route
- Caution: `Rental car, drop-off charges, fuel and lodging not included`
- Pass: `2 resorts covered for your selected pass on the planned ski dates` or `Pass access needs verification`
- Snow: `Historical snow conditions for your planned ski days — not a forecast`
- Link: `Check flights for these dates`

## Relevant external sources

- `fast-flights` one-way example: https://github.com/zilin/fast-flights
- GitHub Actions billing (standard public runners): https://docs.github.com/en/actions/concepts/billing-and-usage
- Enterprise Canada one-way rental restrictions: https://www.enterprise.ca/en/car-rental-faqs/canada-general/one-way-car-rental-policy.html
- Hertz one-way rental fees/booking constraints: https://www.hertz.ca/ca/en/blog/resources/one-way-car-rental
