---
title: "Powder Fares — Agent Handoff (Updated with Owner's Code Findings)"
artifact_type: "product-review-and-engineering-brief"
revision: "v2 — owner-confirmed behavior"
date: "2026-11-16"
latest_ui_source: "Powder Fares.pdf (6-page printout of local version at http://localhost:8765)"
behavior_source: "Project owner's answers from actual code, provided in conversation"
review_scope: "Latest Find trips screenshot + owner-reported implementation; not an independent live-code audit"
status: "Supersedes previous agent handoffs where they conflict"
priority_definitions: "P0 = correctness or financially consequential planning; P1 = material UX/trust clarity; P2 = enhancements and edge-case investigation"
---

# Powder Fares — Updated Product Review and Coding-Agent Handoff

## 0. Instructions for the receiving agent

**Use the current local codebase as source of truth.** The PDF shows the updated *Find trips* UI, but not interactions or the *Plan my season* tab. The owner has subsequently inspected the actual code and answered eight open questions. Treat their answers as **reported current behavior**, not as hypotheses requiring the same initial discovery again. Verify the implementation and add tests before editing critical calculations.

The older GitHub Pages release and earlier reviews may be outdated. **This document supersedes the earlier reviews wherever they conflict.** Do not perform a visual redesign unless new testing identifies a real usability problem. Make targeted improvements without regressing existing features.

**Recommended workflow:** inspect current code -> reproduce target behavior -> make the smallest correct change -> add regression cases -> test Find trips, Plan my season, desktop and mobile -> summarize changes and limitations. Do not assume `localhost:8765` will be reachable outside the project owner's machine.

## 1. Owner-confirmed implementation facts

The following findings were supplied by the owner **from the actual code**. They are higher-confidence than guesses made from the PDF alone, but were not independently code-audited here.

| Topic | Confirmed behavior | Implication |
| --- | --- | --- |
| Blackout message | “2 dates hit pass blackouts” counts **other candidate date options that were excluded**. The recommended option was not on a blackout date. | **Wording/placement defect**, not a confirmed invalid recommended-trip defect. Say excluded *options*, not that the displayed trip is blacked out. |
| Ski dates | Find trips checks the **entire flight-trip span**. The planner assumes skiing starts on the **flight departure day**. | Planner trip-day assumptions need correction. Find trips may conservatively reject valid travel-day combinations; investigate as coverage/UX issue rather than declaring incorrect pass validity. |
| Fare freshness | Check timestamps **are stored per fare** but not displayed. | Expose existing data; don't plan a new timestamp pipeline unnecessarily. |
| Google Flights | The link opens a **route-and-date search**, not a particular guaranteed bookable flight. | Rename CTA to “Search these dates on Google Flights” / “Check current fares.” |
| Best value | **Historical snow rating ÷ (round-trip flight + board-bag cost)**. | Explain as *snow-adjusted airfare value*, not total trip value. Keep formula unless user testing supports a different approach. |
| “Access unconfirmed” | The **pass's resort day-limit entitlement** has not been checked against the official pass website. | It's a pass-eligibility uncertainty, **not** uncertainty about road access or transfer time. Label and position accordingly. |
| “Normal” snow base | A **10-winter average for that calendar day at that specific mountain**. | Give a concise explanation; retain same-resort, same-calendar-day comparison. |
| Planner allocation | For the supported case of **one Ikon product + one Epic product**, owner reports that allocating the **highest-price eligible days first** produces the cheapest answer. | **Withdraw the prior blanket claim that greedy assignment is a defect.** Validate stated constraints with tests. The confirmed material gap is product-specific resort eligibility. |

## 2. Latest visible interface: what already works

Based on the six-page PDF captured November 16, 2026:

- Clear premise: start from a ski pass, see round-trip flights from the LA area including snowboard baggage, alongside historical snow.
- Useful upfront filters: Pass, From, Month, Trip, Sort, Board bag, and airline exclusions.
- The selected *Find trips* view shows 21 Ikon Base Pass mountains with flight results.
- Consistent, readable resort cards include flight price + bag breakdown, airline/stops, airport and driving estimate, travel dates, fare-relative status, snow grade, current/historical base, more dates, and a search link.
- Bag prices are not always the same: for example, Cypress Mountain displays a $170 board-bag allowance for Flair while several US routes show $90. This is a differentiator worth preserving.
- The bottom methodology note states that fares are estimates and snow grades are historical rather than forecasts.

**Assessment:** Keep the current clean, utilitarian presentation. The next gains come from pass correctness, dates, truthful labels and transparent ranking—not an aesthetic overhaul.

## 3. Actual issues and recommended actions (priority ordered)

### P0-A. Enforce exact resort eligibility for Ikon Session and Epic Day products

**Known gap, owner-confirmed:** The planner currently treats Session and Day products as usable at **all resorts in their respective network**, despite pass-product-specific resort eligibility restrictions.

**Why this matters:** The planner could recommend buying a lower-cost product that does not actually cover one or more planned resorts. This can change a person's purchase decision.

**Implementation brief:**
1. Create or verify a product × resort × season eligibility table sourced from official product documentation (with source URL and verification date), rather than treating brand membership as sufficient.
2. Include any relevant restricted resort lists, blackout product variants, ski-day caps, reservation rules and access caveats; distinguish restrictions that are modeled from those not verified.
3. Ensure **both coverage feasibility and total-cost calculations** use the exact product eligibility matrix.
4. If eligibility is not verified, avoid confidently calling the itinerary fully covered by that product. Surface “eligibility not verified” and exclude uncertain products from definitive cheapest-valid-pass claims, or require explicit acknowledgement.
5. Add tests for resorts included in full passes but excluded from Session/Day products; test mixed network and restricted-date trips.

**Acceptance criteria:** A restricted pass is never counted as covering a resort day it does not actually include. The recommended lowest-cost pass combination is *valid for each planned resort and date under modeled restrictions*.

### P0-B. Fix planner ski-day assumptions

**Known behavior, owner-confirmed:** The planner assumes skiing starts on the flight departure day. This can count a travel day as a ski day and distort effective lift costs, blackout checks and pass-choice recommendations.

**Suggested approach:**
- Best option: ask users to choose the specific days they intend to ski for each trip, defaulting conservatively to full days between flight arrival and departure, when flight timing is known.
- If detailed flight times are unavailable, clearly state that ski dates are assumed, show the dates counted, and allow edits. Do not silently assume day-of-departure skiing.
- Do not force “ski the day after arrival” as an immutable rule; early arrivals and late departures can make same-day skiing possible.
- Make eligibility/price recompute when selected ski days change.
- Keep existing *Find trips* trip-span blackout guard until separately reviewed (see P2 below); don't combine these two algorithms by accident.

**Acceptance criteria:** Trips with identical flight dates but different chosen ski days can produce different, correct lift/pass outcomes. Users can see precisely which days were counted.

### P1-A. Correct blackout-warning wording and location

**Known behavior, owner-confirmed:** “2 dates hit pass blackouts” refers to **other excluded candidate date options**. The displayed recommended option is not a blackout itinerary.

**Fix:** Replace with something like **“2 other trip-date options excluded by pass blackouts”**. Better: place it in *More dates* or adjacent to the date-option selector, rather than using warning styling on an eligible featured itinerary. Keep any genuine selected-trip blackout conflict visibly distinct if that situation is ever allowed.

**Acceptance:** A user looking at the featured trip will not infer their chosen pass is invalid for that trip. The number of excluded *options* is accurate.

### P1-B. Replace “access unconfirmed” with precise pass terminology

**Known behavior, owner-confirmed:** This flag means the resort's **pass day-limit allowance has not been checked against the official pass site**; it has nothing to do with driving distance or road access.

**Fix:** Use **“Pass-day limit unverified”**, **“Resort pass allowance not verified”** or equivalent. Put it beside pass entitlement (e.g., “up to 5 days”), not beside “180 min drive”. Add a brief explanation or link to the official pass policy.

**Correctness guard:** If the planner relies on unverified entitlement data, it should avoid falsely guaranteeing pass coverage. Consider a status field `verified / unverified`, with provenance and date.

**Acceptance:** The user knows *what* is unverified and can distinguish uncertain product eligibility from route feasibility.

### P1-C. Surface existing fare timestamps and label search links accurately

**Known behavior, owner-confirmed:** Each fare already has a check time; Google Flights CTA is a route/date **search**.

**Fix:** Show an itinerary-level “Fare checked [date and time]” or compact relative freshness label, using the stored timestamp. Decide how to handle time zones consistently. Rename CTA to **“Search these dates on Google Flights”** or **“Check current fares”**. Keep the footer's estimate-not-quote disclaimer and fare-plus-bag arithmetic.

**Caution:** Do not present an updated webpage timestamp as though every fare was scanned that minute; do not promise that the saved price is currently bookable.

**Acceptance:** Visitors can distinguish when a fare was observed, what it includes, and that the external link launches a new search.

### P1-D. Explain historical snow clearly where users see grades

**Known behavior, owner-confirmed:** The snow “normal” is a 10-winter average for the **same calendar date at the same mountain**. The PDF's methodology says the grade is historical, not a forecast.

**Fix:** Change a typical label such as “A Excellent snow that week” to **“Historical snow: A · typically excellent this week”**. Use **“Current base: 26 cm · 10-season average for today: 14 cm”** (with observation timestamp if available). Keep forecasts separate and explicitly forecast-labeled when the product has genuine predictions.

**Acceptance:** Someone scanning a single card does not mistake historical likelihood for a predicted upcoming storm or guaranteed future base depth.

### P1-E. Define “Best value” accurately; avoid redesigning its math prematurely

**Known behavior, owner-confirmed:** `value_score = historical_snow_rating / (round_trip_fare + selected_board_bag_cost)`.

**Fix:** Add a concise explanation next to the sort selector, e.g. **“Higher historical snow score per dollar of flight + board bag; excludes lodging, lift costs and ground transportation.”** Verify the displayed sort uses the same normalized score and reacts to the board-bag toggle as intended.

**Optional later:** Preference presets for cheapest flight, best historical snow and balanced value; not required for initial correctness.

**Acceptance:** The label's meaning matches the calculation exactly, including bag-toggle behavior and its exclusion of other costs.

### P1-F. Disambiguate pass entitlement from trip ski days

Cards currently show “5 days on Ikon Base Pass” next to a three-night itinerary. This reflects **resort allowance on the pass**, not the number of ski days that flight trip includes.

**Fix:** Use “Ikon Base: up to 5 days of access at this resort” when verified; separately show **planned ski days** in the planner. Preserve “Unlimited” where supported. If the allowance is unverified, pair it with the new status rather than stating unsupported certainty.

**Acceptance:** Pass coverage limits cannot be confused with itinerary duration.

## 4. Withdrawn or materially corrected previous findings

- **Withdraw:** “Recommended trips are blacked out.” The owner says the count refers to *other excluded options*. Keep only the wording/placement improvement.
- **Withdraw as unproven:** “Greedy pass-day allocation is not globally cheapest.” The owner reports the existing method is cheapest for the supported case of one Ikon plus one Epic product. Do not replace it merely because it is greedy. Check its assumptions and eligibility constraints with tests, and reassess if the scope expands.
- **Correct interpretation:** “Access unconfirmed” refers to *pass day-limit verification*, not access roads or airport transfer feasibility.
- **Correct implementation recommendation:** Fare check times are already stored; the job is to display them accurately, not first to add timestamp storage.
- **Correct Google link description:** It launches a search for a route and dates; it is not a guaranteed purchasable flight.
- **Do not claim:** The *Find trips* full-trip-span blackout check is the same as the planner's assumed ski dates. They are separate behaviors.
- **Do not repeat:** Speculative claims from the old published version as confirmed defects of the latest localhost build.

## 5. Secondary improvements and investigation (P2)

1. **Find trips trip-span blackout guard:** Checking all flight-trip calendar days can be conservative, e.g., a blackout on an arrival/departure day might exclude a trip whose actual ski days are eligible. Inspect how the date candidates are generated. If this is intentional conservatism, explain it; if it drops useful options, offer explicit skiing-day selection or date granularity. Do not weaken pass safety without showing actual ski days.
2. **Fare benchmark label:** The PDF says “fares typical vs 60 days”. Verify what sample and period this compares and explain it accurately (do not assume median, lookback or statistical rigor without checking).
3. **Date flexibility, budget, nonstop filters:** Add only where current scan coverage supports accurate results; don't imply unsampled dates have been searched.
4. **Mobile/keyboard checks:** Test filters, date expansion, tab navigation, response to no results, error states and mobile card behavior in a real browser.
5. **Visual refinement:** Only after validation; the current two-column cards and light theme are serviceable.

## 6. Regression test matrix for the agent

| Scenario | Expected result |
| --- | --- |
| Recommended itinerary allowed; two other candidates blacked out | Featured trip shown as allowed; “2 other trip-date options excluded” visible in alternative-date context, not as a warning that trip itself is blocked. |
| Trip with departure flight date but skiing starts next day | Planner counts explicitly selected ski days; no implicit ski day on departure. |
| Same flight dates, one vs three chosen ski days | Planner costs, resort day consumption and pass checks update to reflect selection. |
| Ikon Session product at an unsupported Ikon-network resort | Product correctly excluded from valid coverage even though the brand/network matches. |
| Epic Day product at an unsupported Epic-network resort | Same behavior; no automatic network-wide eligibility. |
| One Ikon + one Epic product with multiple covered ski days | Allocation outcome matches a brute-force baseline across small fixtures, within the supported constraints. |
| Resort day limit has not been verified | UI says “Pass-day limit unverified”; no travel-road confusion; confident pass-coverage recommendation is guarded. |
| Fare scan is older than the page build | The card displays its actual stored fare-check time, not the rebuild time. |
| User clicks external flight CTA | CTA describes opening Google Flights search for route/dates, not a guaranteed exact bookable fare. |
| Snow card with grade A and low current base | Grade clearly identified as historical; current base compared with same-date same-mountain 10-winter average. |
| Board-bag toggle on/off | Displayed costs and value rankings use the correct selected fare+bag denominator. |
| 3-night itinerary and 5-day pass allowance | Wording clearly differentiates resort entitlement from itinerary ski-day count. |

## 7. Suggested implementation order

1. **P0:** Product-specific Session/Day resort eligibility + verification sources, regression tests.
2. **P0:** Planner's explicit or editable ski dates + correct pass eligibility/price recomputation.
3. **P1 quick wins:** Blackout alternative-option wording and pass-day-limit status positioning.
4. **P1 quick wins:** Per-fare timestamps and Google Flights search CTA.
5. **P1:** Historical snow, normal-base explanation, best-value definition and pass-entitlement wording.
6. **P2:** Investigate Find trips' conservative full-trip-span check and optional filters.
7. **Validation:** Browser QA, data/provenance spot checks, accessibility and visual regression.

## 8. Copy examples (adapt to UI and actual data)

- **Blackout alternatives:** “2 other date options excluded by pass blackouts”
- **Unverified entitlement:** “Pass-day limit not verified”
- **Fare provenance:** “Fare checked Nov 16, 7:59 PM PT” *(illustrative format; use the actual individual fare timestamp)*
- **Flight CTA:** “Search these dates on Google Flights”
- **Snow grade:** “Historical snow: A — typically excellent for this week”
- **Snow baseline:** “Current base: 26 cm (10-winter average for today: 14 cm)” *(example values only)*
- **Value explanation:** “Historical snow score per dollar of flight + board bag; not an all-in trip price”
- **Entitlement:** “Ikon Base: up to 5 days at this resort” *(only if verified)*

## 9. Evidence, caveats and desired outcome

**Evidence 1 — visual:** Six-page `Powder Fares.pdf`, a printout of the local `Find trips` screen on Nov 16, 2026. It shows the filtering controls, resort cards, caveat text, global update time and current labels. It does not show the planner's opened UI or interactions.

**Evidence 2 — code-derived owner statements:** The eight answers in the conversation define the behavior of blackout counts, date selection, timestamps, external links, best-value sorting, pass-access uncertainty, snow baselines and planner assignment. These owner-provided facts supersede prior conjecture; they have **not** been independently verified by this review.

**Objective:** A user should be able to find an affordable trip, understand what's included in flight cost, know whether their particular pass covers their planned ski days, understand historical snow versus predictions, and check current fares—without a misleading sense of certainty.

**Definition of success:** Make pass recommendations legally/operationally accurate under the modeled product rules; remove ambiguous labels; retain the existing clean interface and useful price breakdown; test that corrections do not remove good results or introduce new false assurances.
