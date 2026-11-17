---
title: "Powder Fares — Website Review and Agent Handoff"
format: "Markdown"
purpose: "Complete, machine-readable handoff of product, UX, pricing, and implementation feedback from the preceding review"
website: "https://quintin-thomas.github.io/powder-fares/"
repository: "https://github.com/Quintin-Thomas/powder-fares"
review_date: "2026-11-16"
review_type: "Qualitative review of publicly available site and code, not a formal browser or performance audit"
status: "Recommendations; implementation and data accuracy still require verification"
---

# Powder Fares — Website Review and Agent Handoff

## Context and core assessment

**Website:** https://quintin-thomas.github.io/powder-fares/  
**Repository:** https://github.com/Quintin-Thomas/powder-fares

Powder Fares has a useful and differentiated product concept: combining ski-pass access, air travel costs (including ski/snowboard baggage), and snow conditions to help users choose where and when to ski. The season-planning feature additionally asks whether the user is buying the right pass at all.

The product is more interesting than a generic ski resort directory. It helps users make a complicated, expensive decision. The most important product direction is to evolve from **a dashboard showing travel data** to **a decision-making tool that provides clear, actionable recommendations**. The data collection and pricing logic appear more sophisticated than the first impression of the interface communicates.

### Questions the product should answer

1. Where can I ski with my Ikon or Epic pass?
2. How much will it actually cost to fly there with my gear?
3. Where am I likely to find good snow for the money?
4. Am I buying the right pass in the first place?

## Prioritized feedback

| Priority | Area | Finding |
| --- | --- | --- |
| High | Pricing transparency | Explain precisely what quoted costs include and when each fare was last checked. |
| High | Season planner accuracy | Simplified assumptions may lead to misleading pass recommendations. |
| High | Search flexibility | Support specific dates/weekends and real-world itinerary constraints. |
| Medium | Results presentation | Improve information hierarchy so the recommendations are easier to act on. |
| Medium | Value ranking | Make ranking methodology transparent and configurable. |
| Lower | Visual branding | Improve distinctiveness after trust, correctness, and core UX have been addressed. |

## 1. Make result cards easier to act on

### Finding

Resort cards can present flight costs, airlines, equipment-bag fees, airport drive time, snow grades, historical conditions, climate information, blackout notices, and alternative dates. This is potentially useful but overwhelming when most details have the same visual importance.

### Recommendation

Each card should answer three questions immediately:

- **Where should I go?**
- **When should I go?**
- **Why is it worth considering?**

Use the following hierarchy:

1. Destination and applicable pass.
2. All-in quoted flight-plus-equipment-bag cost.
3. Historical/forecast snow outlook (with an accurate label).
4. Airport-to-resort travel time.
5. Suggested trip dates and origin/destination airports.
6. A concise reason for the recommendation.
7. Expandable details for fare breakdowns, weather methodology, climate/ENSO analysis, blackout rules, and alternative dates.

### Illustrative card content (NOT live pricing)

> **Snowbird, Utah** — Ikon Pass — Best value  
> **Round-trip flight + bag:** $325  
> **Historical snow:** A  
> **Airport drive:** 45 min  
> **Trip:** Jan 21–24, LAX–SLC  
> Strong historical snow conditions relative to the price. Nonstop flights available.  
> More dates and price breakdown ▾

**Important:** All monetary values and card details above are illustrative and must not be presented as verified current fares.

## 2. Give users better control over trip dates and constraints

### Finding

The reviewed flight scanner was oriented toward Monday–Thursday and Thursday–Sunday three-night trips, using month and trip-type filters. This is an understandable way to limit scanning workload, but users frequently have fixed vacation windows or constraints that do not conform to those templates.

### Recommendation

Potential filters and search improvements:

- Flexible-date calendar and/or explicit outbound and return dates.
- Maximum total airfare-plus-bag budget.
- Maximum airport-to-resort drive time.
- Nonstop-flights-only option.
- Clear explanation of which date windows have actually been scanned.

There is no need to scan every itinerary immediately. Keep the current efficient data collection schedule, disclose coverage gaps, and expand scanning around the dates and routes users actually request.

## 3. Make airfare and cost estimates trustworthy

### Finding

The cost breakdown including snowboard-bag fees is a strength. The previous review indicated that flight records include a `checked` timestamp, while individual result cards did not visibly display it; instead, the page used a general update timestamp.

A website rebuild timestamp is not equivalent to the age of a specific flight quote. Airfare may change quickly.

### Recommendations

- Display **fare last checked** on each relevant result card, ideally with both date/time and timezone if appropriate.
- Clearly distinguish scanned indicative quotes from currently bookable fares.
- Prefer **Check current flights** instead of **See this flight** unless linking to an exact purchasable itinerary.
- Show the components of total quoted flight cost and explain exclusions or baggage assumptions.
- Identify missing, stale, or unavailable quotes rather than treating them as live offers.

### Cost-label correction

The season planner previously used a phrase like **whole season** for estimates that included flight and lift access but omitted lodging, ground transportation, meals, and other costs. Prefer the accurate label:

> **Estimated lift access + flights**

Do not imply that the estimate captures the entire ski-season cost until major categories are included.

## 4. Improve the correctness of the season-pass planner

This is a **high-priority engineering area**, because the tool may influence purchases costing hundreds or thousands of dollars. Verify current code before acting on the earlier review's findings.

### 4.1 Ski days inferred from travel dates

**Observed issue in earlier review:** For some multi-day itineraries, the algorithm starts counting ski days on the outbound flight date.

**Why it matters:** Many people do not ski on the flight-arrival date, and blackout/date-validity computations can be incorrect.

**Suggested action:** Let users specify their actual ski days, or establish explicit itinerary assumptions (e.g., flight arrival time and first ski day). Evaluate pass eligibility against actual ski days.

### 4.2 Simplified Ikon Session / Epic Day validity

**Observed issue in earlier review:** The calculation treats eligible resort access at a broad brand level, whereas particular pass products can have narrower resort/date access restrictions.

**Why it matters:** A seemingly cheaper pass recommendation may not cover all planned resorts or dates.

**Suggested action:** Use product-specific eligibility tables, restrictions, days, and blackout logic. Make the version/year of pass rules explicit. Test edge cases carefully.

### 4.3 Greedy assignment of ski days

**Observed issue in earlier review:** The optimizer compares multiple product combinations, but uses a greedy allocation to assign individual ski days to passes.

**Why it matters:** The result may not be the globally lowest-cost valid allocation, even if many combinations are considered.

**Suggested action:** Define constraints exactly, then use a globally optimal method (dynamic programming, integer optimization, or exhaustive search when the problem size is small). Validate results against known scenarios and brute-force test cases.

### Suggested pass-planner validation cases

- Flight arrives after ski lifts close.
- Ski date falls on a blackout day for one product but not another.
- A pass covers a destination but a lower-tier day/session product does not.
- Two resorts from different pass networks appear in the same season.
- A pass has insufficient days remaining.
- Greedy allocation picks a locally cheap option that forces a more expensive purchase later.
- User has multiple trips with overlapping ski dates or travel-date assumptions.

## 5. Clarify and improve “Best value” ranking

### Finding

The previously reviewed ranking used approximately:

```
value = snow_score / (flight_cost + equipment_bag_cost)
```

This is a reasonable starter heuristic, but it is not universally equivalent to a user's idea of “best value.” Cheap flights can beat significantly better snow, depending on the denominator and snow-score scale.

### Recommendation

Explain the ranking calculation in plain language and allow users to choose a ranking preference:

1. **Save money:** Primarily favor low flight-plus-bag cost; use snow as a secondary factor.
2. **Balanced:** Consider snow, travel cost, and travel effort together.
3. **Chase powder:** Primarily favor snow conditions; use price as a secondary factor.

Important implementation nuance: validate rankings with human-readable examples, and separate **historical snowfall** from **actual short-term forecasts**. Avoid claiming predictive certainty where the data is climatological.

## 6. Improve first-time user experience and messaging

### Finding

The interface is functional and utilitarian, with straightforward typography, restrained colors, controls, and data cards. A wholesale visual redesign is not the immediate priority. The first screen should communicate the benefit more quickly and help users understand the two distinct workflows.

### Suggested homepage copy

**Headline:**

> Find your next powder trip for less.

**Supporting text:**

> Compare flights, snowboard-bag fees, and historical snow conditions at Ikon and Epic resorts—all from Los Angeles.

### Recommended information architecture

- **Primary:** Find trips (for users who own a pass and want to use it).
- **Secondary:** Is a season pass worth it? (for users choosing among pass products).

These have different user intents and should feel like separate, clearly connected workflows.

### Additional usability/technical findings to verify

- The earlier review noted CSS that hid the editable day-ticket price column on narrow screens. This should be tested on phones and corrected if still present.
- The data fetch previously appeared to lack a dedicated failure state. Add a clear loading/error/empty state and retry path.
- The retrieved live page appeared to have a more limited airline control (e.g., “Skip Frontier”) than the expanded selector and season planner seen in the code. This may have been a stale snapshot; verify the deployed GitHub Pages build matches the intended source version.

## 7. Long-term product direction

The most promising long-term product is a **ski-trip recommendation engine**, not simply a flight comparison dashboard.

Example target experience:

> Your Ikon Pass has three affordable weekend opportunities coming up. Utah has the strongest snow outlook, Colorado is cheaper, and California is easiest to reach.

Potential inputs already present or underway include resort/pass access, historical fare data, historical weather, forecasts, and trip-date availability.

**Do not build the full recommendation engine before validating the usefulness of the current ranking approach with real users.** Product validation should guide further investment.

## Qualitative verdict

These are **subjective assessments**, not measured grades or results from a formal audit:

| Dimension | Assessment | Approximate illustrative score from original review |
| --- | --- | --- |
| Product concept | Strong | 90/100 |
| Data and technical foundation | Promising | 78/100 |
| User experience | Needs refinement | 58/100 |
| Readiness for broad public use | Needs validation | 48/100 |

## Recommended execution order for an implementation agent

1. **Verify the live deployment and current repository state.** Confirm which reported issues still exist before opening fixes.
2. **Audit fare provenance and cost labeling.** Display quote age, clarify bag fees, separate indicative estimates from bookable prices, and identify omitted expenses.
3. **Audit pass-product eligibility and optimize season-planner correctness.** Build regression tests for date validity, resort exclusions, blackout conditions, and global minimum-cost allocation.
4. **Improve the result-card information hierarchy.** Make destination, trip dates, full flight-plus-bag cost, snow outlook, travel burden, and recommendation rationale immediately visible.
5. **Add search flexibility incrementally.** Begin with feasible date/constraint filters that match the available scan coverage.
6. **Provide transparent and configurable value ranking.** Start with budget/balanced/powder choices and explain methodology.
7. **Improve mobile and error/empty states.** Ensure editing and error recovery are not hidden on small screens.
8. **Refine homepage messaging and branding.** Prioritize clarity and trust before decorative redesign.
9. **Test with real skiers/snowboarders.** Measure whether a new user can identify a suitable trip within 30 seconds and understand what the quoted price means.

## Success criteria / acceptance examples

- A user can identify a recommended destination and trip date in **30 seconds** without expanding every result card.
- Every displayed fare clearly communicates how old it is and what costs are included.
- No season pass is recommended for dates or resorts it does not actually cover.
- The planner yields the lowest-cost *valid* combination under its explicit assumptions and constraints.
- Search results disclose which travel dates are covered by the collected data.
- Mobile users can inspect and edit relevant planner data.
- Fetch errors and no-results cases produce understandable recovery options.
- Ranking method and historical-vs-forecast distinctions are legible to users.

## Scope limitations and verification instructions

This file captures the substantive feedback of the preceding review. It does **not** certify that the findings still reproduce in the latest deployment, and it is **not** an interactive browser test, accessibility audit, performance measurement, or exhaustive code audit. Any agent taking action should inspect the live site and repository, confirm each issue, preserve existing working behavior, and test changes before publishing. All sample travel prices are illustrative.

The original response referenced retrieved page/code citations in the chat UI; those ephemeral citation IDs are not durable file references. The stable sources for an agent to inspect are:

- Site: https://quintin-thomas.github.io/powder-fares/
- Repository: https://github.com/Quintin-Thomas/powder-fares

## Open strategic question

**Is Powder Fares intended primarily as a personal tool, a portfolio project, or a product other skiers/snowboarders will use regularly?**

That choice should govern investment priorities, required reliability, feature breadth, analytics, and design polish. Until clarified, prioritize accurate information, understandable recommendations, and a dependable core user journey.
