---
title: "Powder Fares — Updated UI Review and Coding-Agent Handoff"
artifact_type: "product-review-and-implementation-brief"
source_of_truth: "Powder Fares.pdf, uploaded with this conversation (six printed pages)"
source_capture_datetime: "2026-11-16 21:55 (shown in PDF print header)"
review_date: "2026-11-16"
reviewed_view: "Find trips, default Ikon Base Pass / LAX or SNA / Jan–Apr / Any"
review_status: "Visual PDF review only; interactions and current localhost source not inspected"
replaces: "Prior review of public GitHub Pages version for visual/UI findings; do not assume old code findings still reproduce"
priority_definitions: "P0 = trust/correctness risk; P1 = meaningful UX clarity; P2 = enhancements"
---

# Powder Fares — Updated Review / Agent Handoff

## 0. Scope and instructions to a coding agent

Treat **the user's local version** (`http://localhost:8765`) as the implementation to inspect. `localhost` resolves to the machine running the agent, not to a publicly accessible webpage. The uploaded six-page PDF is a **static printout of the newer UI**, not an interactive test. The earlier public GitHub Pages review may describe an obsolete version; verify its findings against the actual local code before carrying anything over.

DO NOT implement these recommendations blindly. For each item: (1) inspect code/data, (2) reproduce or validate, (3) propose the smallest safe change, (4) add appropriate tests, (5) ensure no regression, and (6) distinguish findings verified by source code from observations of the screenshot/PDF.

## 1. Evidence directly visible in the latest PDF

- Page 1: Headline "Pick your pass. See what it really costs to fly to every mountain on it from LA, with your board bag included, plus how the snow usually looks that week." Filters include Pass, From, Month, Trip, Sort; the board-bag checkbox; and a prominent "Excluding: Frontier" control.
- Page 1: Two tabs are visible: **Find trips** and **Plan my season · is a pass worth it?** Only the **Find trips** tab contents are included in the uploaded PDF. We cannot validate the season planner UI or logic from this source.
- Pages 1–6: The displayed result set says **21 mountains on the Ikon Base Pass with flights found, board bag included**. The screen uses two-column destination cards with resort name, state/province, pass-access wording, airport route, drive time, price, fare/bag components, airline/stops, travel dates, fare-history status, snow letter grade, historical typical base, current base, blackout warning, expandable dates and a Google Flights link.
- Page 1: **Sierra-at-Tahoe**: $263 = $173 fare + $90 board bag; Mon Feb 15–Thu Feb 18; "fares high vs 60 days"; grade A; "2 dates hit pass blackouts".
- Page 1: **Palisades Tahoe**: $277 = $187 fare + $90 board bag; Mon Mar 1–Thu Mar 4; "fares typical vs 60 days"; grade A; same "2 dates hit pass blackouts" warning.
- Page 2: **Steamboat** shows "access unconfirmed" beside the drive-time text and "4 dates hit pass blackouts". Other resorts also show "access unconfirmed" (for example Schweitzer, Alyeska, Big Sky, SilverStar, Taos in pages 2–5).
- Pages 2–5: Repeated blackout warnings appear on many result cards, often "2 dates" and sometimes "4 dates". The PDF alone does not establish whether the warning is about the selected itinerary or alternative itinerary options.
- Page 4: **Cypress Mountain** illustrates that bag fees differ by carrier: $438 = $268 fare + $170 board bag, Flair Airlines. This is a strength worth preserving.
- Page 6: A methodology/disclaimer paragraph states prices are estimates rather than quotes; fares can change; bag fees are typical 2026 prepaid per-direction prices; the snow score compares typical conditions for that week using ten historical seasons of Open-Meteo data, **not a forecast unless marked forecast**; pass access is based on published 2026–27 lists. It provides one global update time: 11/16/2026, 7:59 PM.

## 2. Revised assessment

### What is already working

1. The positioning is focused and understandable: ski-pass-covered mountains + airfare + equipment-bag costs + historical snow in a single view.
2. The screen provides useful filters without demanding an extensive form upfront.
3. Prices are prominently displayed, and fares are separated from equipment-bag fees; the fee is not uniformly hard-coded to the same amount across carriers.
4. Cards have relatively consistent hierarchy, borders, spacing, and readable typography.
5. Alternatives ("More dates") and booking-search links give each result an action.
6. The footer is unusually transparent about the historical snow methodology and estimated prices.

**Updated strategic recommendation:** Do **not** begin with a visual redesign. Improve decision reliability, uncertainty labels, and reasoning behind rankings. Maintain the concise, practical interface.

## 3. Prioritized implementation issues

### P0-A. Clarify blackout-warning semantics and validate pass eligibility

**Observed:** Result cards frequently say "2 dates hit pass blackouts" or "4 dates hit pass blackouts" even for the prominently displayed flight itinerary; the reader cannot know whether those dates are **other options** or days during the **recommended trip**.

**Risks:** A user may assume the prominently recommended trip is unusable, or, worse, may book a recommended itinerary when their pass is invalid for the actual ski days.

**Actions:**
- Inspect the calculation and identify exactly what the number counts (trip options, calendar days, ski days, or something else).
- If it counts *alternative itinerary options*, show something unambiguous, e.g. "2 other date options have blackout conflicts" and surface the details under **More dates**, not as an unexplained warning beside the chosen itinerary.
- If it counts ski days **on the selected trip**, show the specific conflicting dates; mark that trip as ineligible for that pass and prevent it from ranking as an ordinary valid recommendation.
- Validate actual ski days and restrictions against the chosen pass tier and 2026–27 eligibility rules. Do not infer ski days from flight dates unless the assumption is explicit.
- Test contrasting pass products, blackout and non-blackout dates, and multi-resort situations.

**Acceptance:** Every blackout message clearly identifies what is blocked; the recommended date is never silently invalid; no false positive appears simply because other candidate dates are blocked.

### P0-B. Clearly separate historical snow conditions from near-term forecasts

**Observed:** Cards say "A Excellent snow that week · usual base 153 cm" and show "base now 26 cm (normal 14)". The necessary caveat that the score is **historical, not predictive** appears only in the page-6 footer.

**Risks:** A visitor may mistake a historical grade for a forecast of powder conditions on the future trip dates. Current-season snowpack and ten-year average should not be visually collapsed into one prediction.

**Actions:**
- Make the grade label explicit at point of use: "Historical snow rating: A" or "Typically excellent conditions for this week".
- Put current measurements on a separate line labeled "Current base", with the date data was recorded.
- Add a compact tooltip or info icon explaining the reference seasons, measured variables, and what the grades compare.
- Only label a genuine time-specific predictive feed as a **forecast**; specify horizon and timestamp.

**Acceptance:** A first-time visitor can explain that an A grade is **not** a weather forecast without scrolling to the footer.

### P0-C. Improve fare provenance and booking-link accuracy

**Observed:** Each result includes quoted estimated fare/bag components and the text "See this flight on Google Flights". Page 6 provides a general "Prices and snow updated" timestamp, but the screenshot does **not** show last-checked information per itinerary.

**Risks:** A particular flight scan may be older than the page refresh; the booking link may open a generic search rather than the same bookable fare; users might mistake flight+bag for whole-trip costs.

**Actions:**
- If individual fare-check timestamps exist, show "Fare last checked [date/time]" per result, with sensible stale thresholds. If not recorded, consider storing them.
- Verify the Google Flights URLs and actual behavior. If they open a search, change link label to "Check current fares" or "Search these dates on Google Flights"; use "See this flight" only if the link truly deep-links to that specific itinerary.
- Retain the valuable fare + equipment-bag arithmetic. Clarify baggage assumptions, currency, and that ground transfers, lodging, lift access, taxes/extra charges not included (if applicable) are excluded.
- Consider a stale-quote indicator or recheck prompt.

**Acceptance:** Each quote communicates cost components, freshness, estimation status, and what will happen after clicking the link.

### P1-A. Explain the "Best value" sorting rule

**Observed:** The default sort is "Best value", but the calculation and tradeoff are not explained beside the filter.

**Actions:**
- Inspect the current ranking implementation rather than assuming the formula from an older version is unchanged.
- Add a short tooltip or help text explaining the major inputs and whether it measures *flight-value*, *snow-adjusted airfare*, or *overall trip value*.
- Do not call it "overall trip value" if lodging, vehicle/transfers and trip time are excluded.
- Consider later adding preference presets such as "Cheapest airfare", "Balanced", and "Best historical snow"; this is optional and lower urgency than defining the existing sort.
- Add rank-order test examples with known data.

**Acceptance:** Users can understand why the first result ranks above a cheaper or snowier alternative.

### P1-B. Make resort pass-day wording unambiguous

**Observed:** Cards use "5 days on Ikon Base Pass" next to trip dates such as Mon Feb 15–Thu Feb 18. Other cards say "Unlimited".

**Risk:** Some users could read "5 days" as scheduled ski days on a 3-night itinerary instead of a pass-product access allowance.

**Actions:**
- Clarify as "Ikon Base: up to 5 ski days at this resort" if that is what the underlying pass actually allows.
- Differentiate allowed pass access from **planned ski days** for the selected trip.
- Keep blackout or reservation conditions accessible from the same line.

**Acceptance:** Access entitlement and trip itinerary cannot be mistaken for one another.

### P1-C. Replace ambiguous climate/fare and access statuses

**Observed:** "fares typical vs 60 days", "fares high vs 60 days", and "access unconfirmed" appear without definitions. The comparator could mean prior 60 days, upcoming 60 days, or a distribution of sampled fares; "access unconfirmed" may have several interpretations.

**Actions:**
- Specify baseline and whether comparison is historical: e.g. "Fare near the 60-day median" only if supported by actual data.
- Define what access confirmation means and display a short, factual explanation (for example, whether road access, flight transfer, or pass access is unverified). Do not guess its meaning.
- Consider softening orange warning treatment for informational flags while reserving warning styling for actual purchase/travel conflicts.

**Acceptance:** No status appears whose subject or meaning is unclear to a first-time user.

### P1-D. Improve long results scanning without clutter

**Observed:** 21 resort cards in a two-column list. Cards are scannable but long, with similar visual weight for prices, dates, historical snow, warnings and links.

**Actions:**
- Keep the current spacious, light, functional design.
- Prioritize: resort and pass validity, price including bag, dates, historical conditions, airport/drive time, then details.
- Consider compact visual tags for **nonstop**, **historical A/B snow**, and **pass restrictions**, without adding excessive badges.
- Use small inline rationale text for top-ranked recommendations only if driven by the real ranking calculation.
- Consider a top-three featured summary if usability testing shows users struggle to identify promising options quickly.

**Acceptance:** New users can choose a promising destination and date within approximately 30 seconds without expanding many cards.

### P2-A. Add flexible trip constraints in stages

**Observed:** Visible filter choices include broad month and trip style, but the PDF does not show a specific date range, max budget, airport-transfer limit or nonstop-only filter.

**Actions:**
- Prioritize a budget ceiling and nonstop-only control if current data supports filtering these reliably.
- Add specific travel dates only if the flight scan actually covers the requested itinerary; otherwise communicate coverage rather than returning misleading results.
- Clarify origin behavior when "LAX or SNA" is selected and individual cards show only LAX itineraries.

### P2-B. Later: Personalization and alerts

Possible expansion after validating the core journey: save a pass, origin airport, acceptable flight price, and snow preference. Optionally notify the user of newly favorable trip options. Do not prioritize before fixing correctness and transparency.

## 4. Previous review recommendations: what to keep, downgrade or reverify

- **Keep:** Per-result quote freshness and clear booking semantics; historical-vs-forecast distinction; ranking transparency; pass blackout validity; basic price breakdown.
- **Downgrade:** Wholesale homepage rewrite, dramatic visual restyling, card redesign. The current introductory copy is already quite specific and the card hierarchy is serviceable.
- **Reverify against current code only:** The older review mentioned travel-day assumptions in the season planner, simplified Session/Day pass restrictions, possible greedy optimization, narrow-screen editable-column behavior and missing error states. These **cannot be confirmed from the latest PDF**, because it only shows Find trips. They are **verification items**, not newly observed defects.
- **Obsolete as an assumption:** The older public website may not reflect the local version. Never treat public GitHub Pages output as evidence of what the current localhost app is doing.

## 5. Suggested safe implementation sequence for an agent

1. **Inventory:** Inspect local app route(s), dependencies, current data schema, data timestamps, filter state, ranking, and season planner. Record what changed from the public build.
2. **Correctness first:** Trace blackout warnings end to end, validate proposed travel/ski dates and restrictions, add tests. Identify what "access unconfirmed" means in source.
3. **Truth in labeling:** Separate historical snow grades from forecasts; clarify pass-day entitlement and fare-history labels.
4. **Price provenance:** Trace fare timestamp/Google Flights link generation; show accurate last-checked and link semantics; preserve included-bag arithmetic.
5. **Ranking explanation:** Document and test existing "Best value" calculation. Explain in the UI before introducing new weightings.
6. **Usability:** Inspect the running website in a real browser (desktop, small mobile viewport), exercise all selectors, alternative dates and both tabs. Make small hierarchy improvements supported by observed problems.
7. **Planner regression audit:** Recheck the previous planner-specific concerns against **current** code and test with known edge cases.
8. **Publish readiness:** Ensure correct loading/error/no-results states, accessibility labels, keyboard interactions, and timestamps/timezones. Only then update the public GitHub Pages deployment when requested.

## 6. Minimum test cases

- For a recommended trip with NO blackout conflict, confirm the card does not display a misleading blocked-trip warning merely because alternative dates are blocked.
- For a recommended trip WITH a blackout conflict, verify the card identifies actual dates and does not present the itinerary as fully eligible.
- A 3-night flight itinerary paired with a pass entitlement of "5 days" must not imply the user will ski five days during that trip.
- Historical grade should remain labeled historical when the trip date is months away; near-term forecasts should have separate timestamp and type.
- Varying bag fees (e.g. $90 versus $170 in the PDF examples) must remain part of the displayed arithmetic when the "Board bag" option is enabled, and be excluded accurately when disabled.
- An itinerary-specific timestamp should not be replaced with the site's last-build time.
- A booking link should open the advertised airline/date search and must not imply a guaranteed live bookable fare.
- "Best value" order should match the code's documented formula on fixed fixtures.
- Origin filters (including LAX or SNA) should not show an itinerary incorrectly labeled with another origin.
- Mobile and keyboard users can view and operate filters, expand date options and navigate both tabs.

## 7. Open questions for local code inspection

1. Does the blackout warning count **alternative itineraries** or **specific selected ski days**?
2. How are skiing dates derived from flights, if at all?
3. Is a quote's last-checked timestamp stored per itinerary?
4. Does Google Flights get exact flight dates, airport and airline/deep-link state, or only a broad route search?
5. What is the precise formula for "Best value" today?
6. What data/test establishes that road/pass "access" is confirmed?
7. Is "normal" in "base now X (normal Y)" calculated for the same calendar date and mountain?
8. Can the pass planner reliably handle product-specific restrictions and find the true minimum under explicit constraints?

## 8. Desired product outcome

A user with a ski pass should be able to answer within ~30 seconds:
- Which mountain is a sensible candidate for the period I can travel?
- What is the estimated **round-trip flight + my equipment bag** cost?
- Is my pass valid for my actual planned ski dates?
- Is the snow rating a historical tendency or a real forecast?
- How fresh is this fare, and where can I check availability?

Once these are reliable, improve personalization and discovery. Prefer **clarity and trust** over adding more visual decoration.

## 9. Source and confidence

**Direct evidence:** User-uploaded `Powder Fares.pdf`, six printed pages captured 2026-11-16; see page references above.

**Confidence:** High for copy/layout and card values visible in the PDF; low/not evaluated for interactions, mobile responsive behavior, API/network behavior, planner algorithms, exact blackout logic, and live flight prices. Examples are displayed **PDF snapshot values**, not revalidated offers.

**Agent instruction:** Review the local source before making any assertion about underlying bugs. Do not use findings from the old version as conclusive evidence.
