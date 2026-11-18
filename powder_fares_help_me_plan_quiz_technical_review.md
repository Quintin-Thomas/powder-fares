# Powder Fares — “Help me plan” quiz: technical design review

Status: **Approve concept; revise recommendation logic and ski-day model before implementation.**
Date: 2026-11-17
Scope: Review of user-supplied proposal. This is a design review, **not** a code audit; no current local source code was inspected.

## Executive assessment

The concept fills a genuine usability gap: the existing planner is useful if someone knows dates and mountains; the quiz would help someone discover a feasible season plan, with the planner retained for edits. The proposed separation (`quiz-core.js` pure engine, `quiz.js` UI, existing `PFCore.plan`) is sensible. Five short questions and several themed alternatives are a reasonable first release.

However, the current plan has four blocking accuracy risks:

1. **A 3-night Thu–Sun or Mon–Thu flight itinerary does not automatically provide three ski days.** Three days starting after arrival includes the flight-home day, which may not be skiable. Travel-date blackout checks are not equivalent to ski-date checks.
2. **Selecting trips from airfare/snow and only afterwards calculating lift pricing cannot guarantee the cheapest total season.** Pass economics should influence itinerary selection, not merely the explanation given after selection.
3. **Existing pass ownership and “help me decide” are different objective functions.** An already purchased pass should normally be treated as sunk cost, while shoppers should compare currently purchasable products (including alternative day tickets) with proper eligibility and costs.
4. **Per-resort day allowances and product-specific eligibility need to be checked across the whole selected season**, not simply verified by pass-network membership. Incomplete or unverified coverage must never result in a confident purchase verdict.

## What to retain

- Two clear entry points at top of Plan my season (guided vs manual).
- Remembered mode preference and saved quiz answers, with safe migration/versioning.
- Five-question discovery approach, large tap targets, progressive disclosure.
- Three *attempted* themed alternatives, primary matching user's priority.
- Pure, deterministic generator using existing price, snow and lift helpers.
- “Open in planner” with confirmation before replacing existing trips.
- Limited-data messaging and keeping existing planner intact.

## Essential revisions (P0)

### A. Introduce explicit intended ski dates

Model a candidate with:

```js
{
  resortId, origin, arrivalAirport,
  departDate, returnDate,
  expectedSkiDates: ["YYYY-MM-DD", "YYYY-MM-DD"],
  tripWindowId, fareCheckedAt, fareBreakdown,
  snowBySkiDate, coverageVerified
}
```

For 3-night Thu–Sun and Mon–Thu itineraries, **default to 2 full middle ski days** unless flight time data supports a third. If accurate flight schedules are available, explicitly mark arrival/departure-day skiing as conditional based on flight times and transfer times; otherwise never claim it as confirmed. Keep the count configurable, and ensure planner accepts the exact ski dates (not `{days:3}` without dates). Grade snow against intended ski days, not the whole flight span.

### B. Generate pass-aware plans, not just pass-aware summaries

The original approach ranks individual trips by airfare/snow, chooses trips greedily, then runs `PFCore.plan()` once. That can select an itinerary that's cheap to fly to but extremely expensive for lift access. Instead, evaluate **whole-season candidates**:

```
seasonCost = sum(available flight + equipment-bag fares for trips)
           + incremental lift-access cost computed over all planned ski dates
```

Show travel costs not included: lodging, ground transfer, food, local transport. For users who already own a pass, incremental pass purchase cost normally = $0; estimate uncovered days separately, and verify remaining resort days (ask if any have been used). For shoppers, compare pass and day-product configurations against actual eligible ski dates and resorts, and avoid claiming a specific purchase is possible without validating sale period and access.

**Search strategy:** Produce an eligible candidate pool, keep a suitably diverse top-K, then use a bounded beam search or constrained combination enumeration over 1–5 trips. Enforce season spacing and no-overlap in search. Re-evaluate complete lift cost (`PFCore.plan`) for each complete season candidate. Keep deterministic tie-breakers. For high trip counts, limit pool size and disclose approximate optimization rather than falsely claiming a global optimum.

Counterexample to cheapest-first: A costs $100 but blocks nearby trip B at $105 due to a 10-day-spacing rule. Pair A+C ($300) totals $400; alternative D ($120)+B totals $225. Picking the lowest individual trip first can produce a worse feasible season. Dates can be chosen to make each pair valid/invalid under the specified spacing policy.

### C. Distinguish already-owned pass from shopping for a pass

Two modes:

- **Already own Ikon/Epic etc.:** Price incremental flight costs and uncovered lifts. Filter for pass eligibility only where explicitly desired, with date-specific blackouts, per-resort caps and prior days used. Do not re-charge the pass price or tell the user to “buy” the already-owned pass.
- **Help me decide:** Generate alternatives across pass families and feasible resorts, and jointly optimize for season cost and requested priority. Ask whether user wants to restrict choices to pass-covered resorts or allow day tickets. Validate product-level Session/Day access, number-of-days cap, holiday options, and current pass sale status before giving a definitive verdict.

If uncertain or access unverified, present “Provisional recommendation — verify resort access and current pass availability” rather than “Buy X: saves $Y.”

### D. Validate limits over the whole proposed season

Use exact ski dates; for each pass product and resort count all assigned uses, enforce: eligible resorts, blackout rules by product/option/date, per-resort quotas, total day-product quotas, and ownership already-used counts. Aggregate all selected trips before `PFCore.plan()`.

Official reference starting points: https://www.ikonpass.com/en/compare-benefits ; https://www.epicpass.com/info/peak-restricted-dates.aspx . Do not assume their current data stays static; record season/version verified.

## Important UX and decision-quality adjustments (P1)

1. **'Somewhere new' can't be inferred from a region filter.** Without travel history call it **'Explore different regions'**; ask for previously visited mountains only if genuinely needed.
2. **Budget matters.** Add an optional maximum flight+bag per trip or season cap (e.g. a small optional field under the cost-priority question or a result refinement), not just a fixed 1.5×-median airfare rule. Show clear total-cost scope.
3. **Themes should rank whole-season plans.** 'Lowest cost' = whole-season estimated cost, not just airfare; 'Best snow' = ski-day-weighted numeric conditions score under budget constraint; 'Explore' = diversity with geographic cost penalty; 'Big-name' = curated preference but still dates/pass/cost feasible. Do not average A–F grades numerically.
4. **Meaningfully different alternatives.** Don't label three nearly identical itineraries as three options. Require substantive variation in destinations or date windows; display two or one if necessary. Explain partial results and stale/missing fare checks.
5. **Determinism.** Same answers + same dataset + same settings => same results. Dates, quote freshness, airline exclusions and bag toggle are inputs to a plan signature. Stable tie-break by IDs and ISO dates; use a versioned storage key.
6. **Don't silently override active planner filters.** Confirm the departure airport (LAX/SNA), checked-bag state, airline exclusions, and selected ski season that the quiz inherited. Make these visible in the result summary.
7. **Pass 'savings' comparisons** must be based on identical resort-and-ski-day itineraries, avoid comparing a chosen plan's pass price to a different plan's day-ticket cost.
8. **Use a precise 10-day spacing policy.** Specify whether measured start-to-start, end-to-start, or ski-day-to-ski-day, and test it exactly. A recommended rule would be `nextTrip.departDate - previousTrip.returnDate >= 10 full days` if the goal is recovery time.

## Suggested minimum data/API contract

```js
// Pure engine -- stable shape, no localStorage or DOM inside.
generateSeasonPlans({
  data, preferences: {
    tripCount,
    months, windowShapes, priority, passStatus,
    selectedPass, regions, budgetCap,
    originAirports, excludeAirlines, includeBoardBag,
    usedPassDaysByResort
  },
  verifiedCoverage,
  nowISO
}) => {
  plans: [
    {
      theme, matchReason,
      trips: [{resortId, win, travelDates, skiDates, fare, fareCheckedAt, snowScore}],
      flightBagTotal,
      liftTotal,
      estimatedTotal,
      passRecommendation,
      unverifiedWarnings,
      coverageDescription
    }
  ],
  limitations: { incompleteCandidateData, tooFewUniquePlans, staleQuotes }
}
```

Planner transfer should be atomic and exact: `PFPlanner.load({trips, skiDates, quoteContext, season})` or an equivalent compatible API; confirm overwrite; guard invalid or stale route identifiers; never wipe a user's saved manual plan accidentally. If exact ski dates aren't supported by planner, modify that contract before shipping the quiz.

## Test plan additions

- Three-night Thu–Sun arrival/return: default two confirmed full ski days, not Friday/Saturday/Sunday without Sunday flight evidence.
- Pass blacklist/blackout on travel date only vs actual intended ski date; test precise days.
- Same resort visited multiple times: aggregate per-resort quota; session/day product total day caps across resorts.
- Existing pass holder: no additional purchase charge, remaining-day allowances respected.
- A cheap flight to an uncovered resort should not beat a slightly pricier covered option when optimizing *total season* cost.
- Greedy counterexample: lowest first leg produces higher full-season cost because of spacing or pass expense; bounded search identifies better combination.
- Best snow under a fixed budget should compare complete plans, using comparable raw snow scores weighted by ski days.
- Priority 'Big-name' has eligibility/date feasibility and graceful fallback when no marquee destinations qualify.
- Duplicate alternatives must be meaningfully different; return fewer than three with explanation if needed.
- Origin, excludes, bag toggle and stored quote timestamps flow through from quiz results to planner; totals reconcile.
- Legacy stored `pf-quiz` and `pf-trips` migration; back button, refresh, multi-tab state, replacing planner plans requires confirmation.
- Season/year boundary and repeated windows; stale quote and missing fare behavior; deterministic tie handling.
- Test browser viewport, keyboard navigation, form controls and screen reader progress/status text.

## Lean implementation sequence

1. **Define date semantics and planner transfer contract**; first fix any existing 3-ski-days-on-travel-day issue in planner.
2. **Build an eligibility-aware candidate generator** with accurate ski dates, price freshness and pass limits; test.
3. **Build whole-season scoring/search** that considers lift cost; test against small exhaustive fixtures.
4. **Build five-question quiz UI and results**; concise, visible estimated-cost scope and caveats.
5. **Confirm saved-state integration and responsive/accessibility checks.** Keep the existing manual planner one click away.
6. **Pilot with one or two-trip plans** before expanding to 4–5 trips; monitor limited-data cases, product availability and speed.

## What must be verified in current codebase

- Exact shape and year of `D.routes` and `resort.snow[wk]`, flight check timestamps and candidate quote windows.
- `PF.bestQuote` semantics for origin, bag fees and airline exclusions.
- `PFCore.plan` contract, handling of owned passes, day-product eligibility, per-resort caps and quote provenance.
- Existing planner date representation and whether it allows precise ski-date overrides.
- Date overlap/spacing and storage migration.

Do not present any item in this review as a confirmed current-code defect without opening the latest code. The risks arise from the *proposed plan*.
