# Google Flights integration evaluation

Research only. No third-party code was installed, imported or executed. No Powder Fares code, data, schedule or link was changed.
Prepared 2026-11-18 (UTC 2026-11-19) against `main` at `23cbecf`.

Evidence labels used below:
- **Verified**: read in source code, repository metadata, or Powder Fares' own stored scan records.
- **Inferred**: a reasonable conclusion from verified facts, not directly tested.
- **Unknown**: not established; says what evidence is missing.

---

## 1. Executive summary

**Recommendation: keep fast-flights and refine the existing scanner. None of the four alternatives is a measurable improvement for Powder Fares, and none passed the security gate.**

- All five options, including the current one, read unofficial Google Flights pages or internal RPC endpoints using browser TLS impersonation. Switching tools changes how fares are parsed, not the access model or its risk. (Verified)
- The alternatives' headline features either don't fit Powder Fares or aren't what the README implies:
  - Swoop has no flexible-date search, despite a docstring pointing to one.
  - Viajante's "flexible dates" is one search per day.
  - The MCP server is a fast-flights wrapper with a paid SerpApi fallback.
  - claude-flights has no licence and adds nothing beyond fast-flights. (Verified)
- The largest gains available are inside the current stack (section 6):
  - handle Google's status-13 throttle response with a cooldown instead of quick retries
  - start scanning multi-mountain one-way legs (0 of 270 searched so far)
  - evaluate fast-flights' existing multi-city query for open-jaw trips
  - adopt the upstream parser fix once it ships in a release
- Security gate: SkillSpector 2.12.0 ran in static mode (`--no-llm`) on all five pinned snapshots. It reported **partial coverage (0 of N components fully scanned) for every repository**. Per the brief, the review stops there: no tool is cleared for installation or execution.

---

## 2. Current Powder Fares scanner

### Architecture (verified)
| Part | What it does |
|---|---|
| `pricing/source.py` | Provider interface: `Itinerary` (origin, dest, depart, optional return), `Quote` (price, airlines, stops, first-segment departure and last-segment arrival time), `SearchResult` (quotes, URL, Google typical range, ~60-day price history, currency). Designed so a paid API can replace Google by implementing `search()`. |
| `pricing/google.py` | Adapter over fast-flights. Builds an economy, 1-adult, USD, `en` query; fetches with fast-flights' fetcher; parses Google's `ds:1` JSON itself; **merges the "top flights" block** (payload[2]) that fast-flights 3.1.0 skips; drops unpriced listings; extracts price insights (typical low/high, ~60 days of daily lows). Classifies failures: `bot_check`, `google_error`, `no_results_block`, `unreadable`, timeout. 3 attempts with 5 s / 10 s backoff; no retry after `bot_check`. Pause 1.5 s between searches (scan.py), 4× pause after a failed unit. Optional `HTTPS_PROXY` is honoured if set (not set in CI). |
| `scan.py` | Units: (origin LAX/SNA × resort airport × 3-night window, Mon–Thu and Thu–Sun, Jan 4–Apr 25) = **3,264 round-trip units**; multi-mountain adds **270** (180 round trips into hubs + 90 one-way legs). Since `23cbecf`: overdue re-checks keep up to 40 % of each run; never-searched windows go earliest departure first across all routes; multi-mountain units only get leftover budget. Refresh intervals: ≤30 days out every 2 days, ≤75 every 4, else every 7. Stops after 15 consecutive failures; 35-minute time cap; saves every 25 searches. |
| Bag pricing | `bag_total()` adds the airline's board-bag fee from `data/airlines.json` (×2 round trip, ×1 one-way); our "daily low" history uses default exclusions. Google's own bag-fee option is not used. |
| Storage | `store/quotes/<O>-<A>.json` (latest per window: cheapest fare per airline, stops; times for one-ways), `store/history/…` (our daily lows + Google history), `store/quotes/ow/…`, `store/scan_state.json`, `store/last_scan.json` (health). Git is the database. |
| `build.py` | Publishes `site/data.json`: per window `checked`, `url`, `by_airline`, `typical`, `fare_level` (low/typical/high vs Google's 60-day history), `g60`, `spark`; one-way legs; health. |
| Search links | `Query.url()` from fast-flights: `https://www.google.com/travel/flights/search?tfs=…&hl=en&curr=USD`. |
| Schedule | `.github/workflows/daily.yml`: 12:17 and 00:17 UTC, budget 350; pushes run publish-only (budget 0). One concurrency group, no cancel. |

### Dependency versions (verified, `requirements.txt`)
`fast-flights==3.1.0`, `primp==2.0.1`, `protobuf==7.36.2`, `selectolax==1.0.2`. fast-flights 3.1.0's default fetcher uses `primp.Client(impersonate="chrome_145", impersonate_os="macos", cookie_store=True)`.

### Operational record (verified from git history of `store/last_scan.json`)
| Run (finished, UTC) | Planned | Searched | OK | Failed units | Attempt errors | Avg s/search | Note |
|---|---|---|---|---|---|---|---|
| Nov 16 (initial, local) | – | ~120 | – | – | – | – | no health record |
| Nov 17 03:2x | – | ~300 | – | – | – | – | no health record |
| Nov 18 02:17 | 350 | 350 | 343 | 7 | 84 JSONDecodeError, 18 blocked/no results | 3.4 | older error labels |
| Nov 18 13:49 | 350 | 17 | 1 | 16 | 41 google_error, 3 bot_check | 7.4 | stopped: 15 failures in a row |
| Nov 19 02:10 | 350 | 350 | 330 | 20 | 120 google_error, 13 bot_check | 3.8 | 27.1 min |

- Per-unit success across the three recorded runs: 674 of 717 searched units (94 %). One of the three recorded scheduled runs was effectively blocked. (Verified)
- Coverage at Nov 19 02:10: 1,137 of 3,264 round-trip units ever priced; 0 SNA units (fixed going forward by `23cbecf`); **0 of 270 multi-mountain units ever searched**. (Verified)
- Steady-state demand (`scan.py --dry-run`): ~565 searches/day single-mountain + ~46 multi-mountain, against 700/day capacity when both runs succeed. (Verified)

**Missing evidence:** only three health records exist (the site is three days old), so there's no basis yet for a block rate by time of day, a week-over-week trend, or fare accuracy vs a manual Google check. No independent accuracy sample has ever been taken.

### Strengths (verified)
- Clean provider interface; the adapter already fixes fast-flights' two known parser gaps.
- Price-insight history (60-day lows) gives "fare level" context the alternatives don't provide out of the box.
- Conservative behaviour: low volume, pauses, no retry on bot checks, stops after 15 consecutive failures, no proxies or rotation.
- Failure kinds and samples are recorded per run.

### Limitations (verified unless marked)
1. `google_error` (Google's status-13 `ErrorResponse`) is retried after 5–10 s. Viajante's source treats a burst of status 13 as a throttle needing a multi-minute pause and notes that cloud IPs are more likely to be throttled. GitHub-hosted runners are cloud IPs. (Inferred that a cooldown would recover runs like Nov 18 13:49; untested.)
2. Multi-mountain one-way legs have never been scanned because they only get leftover budget.
3. Open-jaw trips are priced as two separate one-ways. fast-flights supports `trip="multi-city"`, which would price a single ticket; often different, sometimes cheaper. (Inferred; untested.)
4. Bag fees come from our own table. fast-flights' `checked_bags=` asks Google to include its fee estimate; this could cross-check the table. (Untested: whether Google's estimate covers board/sports bags is unknown.)
5. Basic-economy fares are included (fast-flights default). This is a product choice; it should be disclosed or made consistent.
6. Only first-segment departure and last-segment arrival times are kept, and only for one-ways.
7. No outlier check before publication (e.g. a fare 60 % below the route's 60-day low is published as-is).

---

## 3. Repository comparison (read-only inspection at pinned commits)

All snapshots were downloaded as tarballs from `codeload.github.com` into an isolated temp folder, read as text, and scanned statically. Nothing was installed or imported.

| | fast-flights (upstream) | Swoop | Viajante | Google Flights MCP | claude-flights |
|---|---|---|---|---|---|
| Repo | AWeirdDev/flights | saraswatayu/swoop | felipebasurto/viajante | HaroldLeo/google-flights-mcp | victoraraujo01/claude-flights |
| Commit reviewed | `5fd011e34da5` (2026-11-15) | `59fbafc5b712` (2026-06-24) | `4eca470df207` (2026-11-18) | `4cc197ee6f2b` (2026-11-18) | `97c10bfb6635` (2026-03-12) |
| Latest release | v3.1.0 (2026-08-18); master has unreleased fixes | swoop-v0.7.0 (2026-06-24) | v1.6.0 (2026-11-18) | none | none |
| Licence | MIT | MIT | MIT | MIT | **none** (default copyright; code can't be reused) |
| Activity / adoption | 2.1k stars, 35 open issues, maintainer says part-time | 101 stars, 13 open issues, no commits since June | 57 stars, very active (daily releases) | 8 stars, active | 0 stars, inactive since March |
| Runtime | Python ≥3.10; primp, protobuf, selectolax | Python ≥3.10; primp, protobuf (+ click/rich/babel for CLI) | Python ≥3.10; curl-cffi, selectolax, airportsdata; optional mcp, playwright; npm wrapper | Python; mcp<2, fast-flights pinned to git `7c105db`, google-search-results (SerpApi), uvicorn | unpinned `fast-flights` |
| Access method | GET `/travel/flights?tfs=…`, Chrome TLS impersonation | POST to internal `FlightsFrontendUi` RPC, Chrome TLS impersonation | Public page + internal RPC, curl-cffi Chrome impersonation; also Skiplagged MCP, Booking.com, Google Hotels | fast-flights; optional SerpApi | fast-flights, monkey-patched to impersonate Edge 145 |
| API key | No (optional paid integrations: SearchApi, Bright Data) | No | No (Skiplagged path calls `mcp.skiplagged.com`) | No; SerpApi fallback needs a paid key | No |
| One-way / round trip | Yes / yes | Yes / yes | Yes / yes | Yes / yes | Yes / yes |
| Multi-city / open-jaw | `trip="multi-city"` | `search_legs` / `price_legs` | Yes (`MultiCity` model) | No multi-city tool | No |
| Flexible dates | No | **No** (docstring refers to "date flexibility" in `search`, but no such parameter exists) | One search per day in a window (`dates.py`) | `search_round_trips_in_date_range`: one search per date pair | Brute-force date combinations |
| Airline / stop filters | Per-leg airlines, alliances, max stops, time windows, layovers, `exclude_basic_economy`, bag-fee inclusion | Airlines, max stops, time windows; **excludes basic economy by default** | Yes | Airline tool (client-side matching) | Basic |
| Flight times | Per segment | Per segment, layovers, emissions | Yes | Yes | Yes |
| Price insights / history | Not parsed (Powder Fares parses them itself) | Deals feed has `typical_price`; no per-search history | `typical.py`, local history/watch | No | No |
| Throttle handling | None | Retries on HTTP 429 with backoff (default 2) | Machine-wide cooldown file; status-13 burst = pause; 2–30 min | Falls back to SerpApi if configured | None |
| Other side effects | – | Repo ships `.claude/hooks` that run if the repo is opened in Claude Code | Writes state files (consent cookie, rate-limit, history) to the user's state dir; submits Google's **reject** cookie form | Disables MCP DNS-rebinding protection globally (comment: runs behind HF Spaces proxy) | Monkey-patches fast-flights' fetcher at import |

### Notable upstream fast-flights changes since v3.1.0 (verified by diff against the installed 3.1.0)
- `parser.py`: merges payload[2] ("best") and payload[3] and allows unpriced itineraries (`price: int | None`). **Powder Fares already does both in its adapter.**
- `querying.py`: adds `tfu=EgQIABABIgA` ("show all flights and prices") to request parameters and to `Query.url()`. Adopting it would change the stored search links, so it needs approval under the no-link-changes constraint.
- Not released to PyPI; the MCP server pins git commit `7c105db` to get it.

---

## 4. Security and automated-access risks

### Google terms and robots.txt (verified 2026-11-19)
- `https://www.google.com/robots.txt` (User-agent `*`) disallows `/travel/flights/search`, `/travel/flights/booking`, `/travel/flights/s/`, `/travel/search` and `/travel/clk`. It does **not** list `/travel/flights` itself (fast-flights' fetch path) or `/_/FlightsFrontendUi/` (Swoop and Viajante RPC).
  - Viajante's hotel search uses `/travel/search`, which is disallowed.
- Google Terms of Service (effective July 30, 2026) prohibit using automated means in violation of machine-readable instructions such as robots.txt, and also prohibit "bypassing our systems or protective measures".
- **Assessment (inferred, not legal advice):** every option here, the current one included, uses TLS impersonation designed so Google's frontend accepts the request. Whether that counts as bypassing protective measures is a judgement the owner has to make; it isn't a technical question. robots.txt compliance on the fetch path doesn't settle it. Production use carries ToS risk regardless of which library is used. The lowest-risk posture is the one Powder Fares already has: low volume, back off on blocks, no proxies, no rotation, no CAPTCHA handling. A licensed data source remains the long-term answer if the site grows.
- Breakage risk: all five depend on undocumented response layouts (positional arrays). Upstream fast-flights needed three releases in 2026 for layout changes. Swoop and Viajante decode deeper RPC structures, so they have more surface to break. (Inferred)

### Credentials and cookies (verified)
- fast-flights: `cookie_store=True` per client (in-memory). The integrations read API keys from env/`.env` (`integrations/base.py` loads dotenv on import).
- Viajante: persists Google's `SOCS` consent cookie (reject choice only) for 30 days, plus rate-limit state.
- MCP server: reads `SERPAPI_API_KEY`.

### SkillSpector gate
- Tool: NVIDIA SkillSpector v2.12.0 (local copy in `SkillSpector/`), static analysis only (`--no-llm`), JSON output.
- Reports are saved outside the repo in this session's scratchpad: `/private/tmp/claude-501/-Users-uzu--claude-workspace/df00dda1-59e5-49af-bd5e-418ca42c99bb/scratchpad/flight-integrations/skillspector/`.
- **Limitation:** the first run couldn't reach `api.osv.dev`, so dependency CVE checks fell back to SkillSpector's offline data. A second run with OSV allowed was interrupted partway, so it isn't known which saved reports include live OSV results.

| Repo | Tarball SHA-256 | Report SHA-256 | Risk score / recommendation | Findings (H/M/L) | Coverage |
|---|---|---|---|---|---|
| flights | `34b76dec07d8…8b35e` | `e99468b541b6…52f0`* | 69 HIGH / DO_NOT_INSTALL | 3 / 2 / 4 | partial: 0 of 46 components fully scanned |
| swoop | `90341cdcfe81…7b1e` | `4590740b4994…09e6`* | 100 CRITICAL / DO_NOT_INSTALL | 12 / 4 / 3 | partial: 0 of 152 |
| viajante | `9ce3f47e27db…a393` | `d1b8d05a79e0…10e2`* | 100 CRITICAL / DO_NOT_INSTALL | 22 / 166 / 33 | partial: 0 of 246 |
| google-flights-mcp | `86074c469a3d…1a70` | `558b43aebcb3…79e0`* | 13 LOW / CAUTION | 0 / 0 / 8 | partial: 0 of 13 |
| claude-flights | `c2157f92a130…7dc7991` | `2bc7e3814b64…52f0`* | 28 MEDIUM / CAUTION | 0 / 4 / 2 | partial: 0 of 5 |

\* Report hashes as saved after the interrupted second run.

Main high findings. These are not reviewed one by one; several look like pattern matches on legitimate code, but that's unconfirmed:
- **flights:** chained-tool pattern in `.github/workflows/docs.yml` (CI only); credential/env access in `integrations/base.py:58` (reads API-key env vars for the paid integrations).
- **swoop:** executables in `.claude/hooks/*.sh` (they run in any Claude Code session opened in that repo); credential-file and env patterns in those hooks; one hidden-instruction and one context-leak pattern.
- **viajante:** env-var enumeration (7), reads of agent configuration directories (5), unsafe tool-parameter patterns, one obfuscation pattern, one hidden-instruction pattern; its `.claude/skills/verify` scripts and publish workflow.

**Gate result: stop.** Coverage is incomplete for every repository, which the brief defines as a stop condition. A clean report wouldn't have been sufficient anyway. No tool is cleared to install, run or connect.

---

## 5. Feature comparison matrix

Ratings: 1 (poor) to 5 (good), for Powder Fares' use case: unattended GitHub Actions, static site, about 700 searches a day.

| Option | Reliability | Maintainability | Functionality fit | Security | Cost | Integration effort (5 = least) | Evidence |
|---|---|---|---|---|---|---|---|
| Current fast-flights 3.1.0 + adapter | 3 | 4 | 4 | 3 | 5 | 5 | 94 % unit success but 1 of 3 runs blocked; small dependency tree; price insights already parsed (verified) |
| fast-flights latest (master) | 3 | 4 | 4 | 3 | 5 | 4 | Same access model; parser fix duplicates ours; `tfu` changes URLs; unreleased (verified) |
| Swoop | 3? | 2 | 3 | 2 | 5 | 2 | Richer RPC data and multi-leg pricing; no flex dates; basic economy excluded by default; inactive since June; full adapter rewrite; gate failed (verified) |
| Viajante | 3? | 2 | 3 | 1 | 5 | 1 | Best throttle handling; very large surface (hotels, Skiplagged, Booking.com, MCP, npm); writes state; flex dates = N searches; gate failed (verified) |
| Google Flights MCP | 3 | 3 | 2 (manual verification only) | 2 | 4 (SerpApi is paid) | 3 | Wrapper on fast-flights; DNS-rebinding protection off; useful only for ad-hoc agent checks (verified) |
| claude-flights | 2 | 1 | 1 | 2 | 5 | 1 | No licence; monkey-patch; brute force (verified) |

"3?" = reliability under scheduled cloud execution is unknown; nothing was run.

| Capability (importance) | Current | Best alternative | Better? |
|---|---|---|---|
| Round-trip fares (critical) | Yes | All | No measurable difference shown |
| One-way for open-jaw (critical) | Supported; never scanned yet | Swoop/Viajante multi-leg pricing | Same capability is in fast-flights (`multi-city`) |
| Airline and bag compatibility (critical) | Own fee table; per-airline cheapest | fast-flights `checked_bags` | In-stack option |
| Dates and times (high) | One-way times only | Swoop per-segment | Data is in fast-flights results already (not stored) |
| Flexible dates (high) | Fixed 3-night windows | None has a calendar/price-graph endpoint | No |
| Fare verification (high) | Link to Google | Swoop booking-option price check (+1 RPC each) | Marginal; doubles request volume |
| Scan efficiency (high) | 1 request per unit | Same or worse | No |
| Destination exploration (medium) | n/a | Swoop/Viajante explore | Not needed (fixed resort list) |
| MCP for Claude (medium) | n/a | MCP server / Viajante | Manual only; gate failed |
| Price history (medium) | Google 60-day + our daily lows | None better | No |

---

## 6. Recommended improvements (inside the existing stack, highest value first)

Each needs separate approval. None changes pricing algorithms, bag maths, schemas, links or schedules unless noted.

1. **Status-13 cooldown** (`pricing/google.py`, `scan.py`). After about 3 `google_error`s within 2 minutes, pause 5–10 minutes once, then resume; keep the 15-in-a-row stop. Record the cooldown in health. This respects Google's signal rather than evading it. *Low effort.*
2. **Reserve budget for multi-mountain legs** (`scan.py`): a small guaranteed share (e.g. 10 %) so the 270 units get first prices. *Low effort, reuses `pick()`.*
3. **Open-jaw as multi-city, evaluated first**: compare `trip="multi-city"` single-ticket prices against two one-ways on the section 7 sample before changing any multi-mountain logic. *Medium effort; changes an itinerary model, so explicit approval needed.*
4. **Pre-publication sanity check** (`build.py`): flag (don't drop) fares below 40 % of the window's 60-day low or above 3× its high; surface the count in health. *Low effort.*
5. **Store per-segment times for round trips** (additive field; needs approval because it touches the quote schema). *Low–medium effort.*
6. **Track upstream fast-flights**: when a release includes the result-group fix, upgrade and delete our duplicate merge code. Decide separately whether to adopt `tfu` (it changes links). *Low effort.*
7. **Bag-fee cross-check** (research only): one-off comparison of Google's `checked_bags=1` estimate vs `data/airlines.json`. Never replaces the table automatically. *Low effort.*
8. **Accuracy sampling**: a weekly manual check of 10 published fares against Google Flights in a browser, recorded in a log. This is the missing accuracy evidence. *Process only.*

Not recommended: proxies, IP or user-agent rotation, CAPTCHA services, a third daily run while blocks continue, or paid APIs without a separate decision.

---

## 7. Proposed ten-search evaluation (not executed)

Only relevant if a tool later passes the security gate. The same matrix also measures items 3 and 6 above using fast-flights alone.

**Fixed assumptions for every tool:** 1 adult, economy, USD, `hl=en`, basic economy **included** (Swoop needs `include_basic_economy=True`), no bags in the query (bag fees added afterwards from `data/airlines.json`), no proxy, 1.5 s pause between searches, run from the same machine in the same 30-minute window, each tool run once in alternating order.

| # | Type | Search | Source in dataset |
|---|---|---|---|
| 1 | Round trip | LAX–RNO 2027-02-15 → 02-18 | Sierra-at-Tahoe featured result |
| 2 | Round trip | LAX–DEN 2027-01-25 → 01-28 | Colorado hub; `google.py` demo route |
| 3 | Round trip | SNA–SLC 2027-03-04 → 03-07 | Utah; SNA origin |
| 4 | One-way | LAX → DEN 2027-01-09 | multi-mountain outbound (5-night Sat window) |
| 5 | One-way | SLC → LAX 2027-01-14 | multi-mountain return |
| 6 | One-way pair vs multi-city | LAX → DEN 01-09 + SLC → LAX 01-14 as one ticket | open-jaw comparison |
| 7 | Canada | LAX–YVR 2027-02-04 → 02-07 | Whistler |
| 8 | Canada | LAX–YLW 2027-03-11 → 03-14 | Big White / SilverStar |
| 9 | Flexible | LAX–RNO, departures 2027-02-08…02-21, 3 nights | only where both tools support it |
| 10 | Flexible | LAX–DEN, departures 2027-01-25…02-07, 3 nights | same |

Swap any route or date that is no longer in `site/data.json` on the test day for the nearest one that is.

**Recorded per search:** lowest fare; currency; dates echoed back; airline(s); stops; per-segment departure and arrival times; whether basic economy is included; bag handling; number of itineraries returned; wall time; HTTP status, errors, retries, timeouts; and the fare shown by a human on google.com/travel/flights for the same query within 15 minutes (screenshot kept).

**Comparability rules:**
- A difference counts only after confirming the same itinerary (flight numbers) and fare class.
- A cheaper result is not "more accurate" unless the human check shows that fare.
- Flexible-date results count as complete only when every date in the range returns a price.

**Pass bar to justify a switch:**
- at least 8 of 10 matching the human check within $5, versus the current scanner's result
- no extra errors
- no more requests per unit
- **and** a capability the current stack can't provide

---

## 8. Estimated engineering complexity

| Change | Effort | Risk |
|---|---|---|
| Improvements 1, 2, 4, 6, 7 | 0.5–1 day each, with tests | Low |
| Improvement 3 (multi-city open-jaw) | 2–3 days including evaluation | Medium (pricing semantics) |
| Improvement 5 (segment times) | 1 day | Low (additive schema) |
| Replace provider with Swoop | 4–6 days: new adapter, price-insight gap, re-baseline history | High |
| Replace provider with Viajante | 5–8 days plus ongoing review of a large, fast-moving codebase | High |
| MCP server for manual checks | 0.5 day setup, outside the pipeline | Medium (security config) |

---

## 9. Recommended next steps

1. Approve or decline improvements 1 and 2 (cooldown, multi-mountain share). These directly address the observed failures and gaps.
2. Optionally approve a one-off fast-flights-only run of the section 7 matrix (current stack, no third-party code) to measure accuracy and multi-city pricing.
3. Re-check upstream fast-flights for a release that contains the parser fix; decide on `tfu`.
4. Revisit alternatives only if fast-flights stops working. Re-run the security gate at the new pinned commits with full coverage, and with an LLM-assisted SkillSpector pass if you approve one.

---

## 10. Sources

- Powder Fares at `23cbecf`: `pricing/source.py`, `pricing/google.py`, `scan.py`, `build.py`, `.github/workflows/daily.yml`, `requirements.txt`, `store/last_scan.json` history (`e855b6e`, `0e38236`, `3c46e7e`), `store/scan_state.json`.
- fast-flights 3.1.0 as installed (`fetcher.py`, `querying.py`, `parser.py`, `integrations/`) and upstream https://github.com/AWeirdDev/flights at `5fd011e34da59c7fef4cf7ad9a5571622b70432d`.
- https://github.com/saraswatayu/swoop at `59fbafc5b712435051d36d391045a0ca73392e21` (`README.md`, `SECURITY.md`, `pyproject.toml`, `swoop/__init__.py`, `rpc.py`, `models.py`, `.claude/`).
- https://github.com/felipebasurto/viajante at `4eca470df207efa289c99be5dc8aa50324e48998` (`pyproject.toml`, `src/viajante/dates.py`, `ratelimit.py`, `consent.py`, `feedback.py`, `airports.py`, `google_flights*.py`, `skiplagged.py`, `mcp_server.py`).
- https://github.com/HaroldLeo/google-flights-mcp at `4cc197ee6f2ba5a640d4870d809be11dde2aa898` (`pyproject.toml`, `requirements.txt`, `src/mcp_server_google_flights/server.py`).
- https://github.com/victoraraujo01/claude-flights at `97c10bfb6635c5e549792559108a2763f75ae9b5` (`search_flights.py`, `.claude/skills/flights/SKILL.md`, `requirements.txt`).
- GitHub REST API repository, commit and release metadata (retrieved 2026-11-19).
- https://www.google.com/robots.txt (retrieved 2026-11-19); Google Terms of Service, https://policies.google.com/terms, effective July 30, 2026.

**Not verified:**
- live behaviour of any alternative (nothing was run)
- the current scanner's fare accuracy against a human check
- whether Google's bag-fee estimate covers sports equipment
- individual triage of each SkillSpector finding
- live OSV results for every report

---

## 11. Approval gates

Nothing beyond this document proceeds without your explicit approval, step by step:

| Gate | Needed before |
|---|---|
| G1 | Any change to `pricing/`, `scan.py`, `build.py` (improvements 1–6), each one separately |
| G2 | Any change to search-link format (e.g. adopting `tfu`) or the quote schema |
| G3 | Running the section 7 matrix with the current stack |
| G4 | Downloading any further third-party code, or re-scanning with network or LLM access |
| G5 | Installing, importing, running or connecting any third-party tool or MCP server; requires a complete-coverage security review first |
| G6 | Any paid service (SerpApi, SearchApi, Bright Data, licensed fare APIs) |
| G7 | Commit, merge, push or deploy of this document or anything else |

---

## Addendum (2026-11-19): FlightClaw, fli and skillhq/flight-search

These were reviewed read-only: the public web page plus GitHub API metadata and selected files. Nothing was downloaded as an archive, scanned with SkillSpector, installed or run, so **none of them has passed the security gate (G4/G5)**. **The recommendation in section 1 is unchanged.**

### FlightClaw (https://flightclaw.com/claude-code)
The page describes two separate products. (Verified from the page.)

- **Hosted connector** `https://mcp.flightclaw.com/mcp`:
  - fares from about 300 airlines through **Duffel** (a licensed fare/booking API)
  - sign-in by email code (OAuth)
  - tools: `search_flights`, `get_offer` (bags and fare rules), `create_checkout`, `get_order`/`cancel_order`, `save_traveler`/`list_travelers` (passport names), `set_preferences`
  - searching is free; bookings carry a 5 % + $3 fee (minimum $12) and changes cost $6
- **Fit for Powder Fares: no.**
  - It is built for interactive search and booking in a chat, not unattended bulk scanning; its terms for bulk or automated use aren't stated on the page. (Unknown)
  - Every scan query would go to a third party under an account, and the service also stores traveller identity data. That's a privacy and dependency change. (Inferred)
  - **The useful pointer is Duffel itself:** a licensed alternative to unofficial Google access if Powder Fares ever needs one. That is a paid-service decision under G6, with its own terms review.
- **Open-source skill** `flightclaw/agents`: MIT, about 86 stars, last commit `7df2e70fd90d` (2026-10-26), no releases. Its Google Flights search runs on **fli** (below).

### fli (https://github.com/punitarani/fli)
- MIT, about 3,500 stars, last commit `af5d0ed82a8c` (2026-11-11). Python library, CLI, MCP server and a JS package (`fli-js-v0.0.4`). (Verified)
- Access: reverse-engineered Google Flights requests through `curl_cffi` with browser impersonation, plus `tenacity` retries. (Verified, `fli/search/client.py`)
  - Its client rate-limits to **10 requests per second** globally, far above Powder Fares' pacing (1.5 s pause per search). Using it would need our own throttle on top. (Verified)
- Features: one-way, round trip and multi-city (`fli/cli/commands/multi.py`); a date-range search with fixed trip `duration`, stops and airline include/exclude filters; and explore. (Verified)
- **Flexible dates aren't a shortcut.** fli's own source notes that Google's `GetCalendarGraph` RPC (the endpoint that used to return a whole calendar of prices in one request) is gated and no longer used. Its date search now sweeps one search per date in chunks, the same request cost as Powder Fares' per-window units. (Verified, `fli/search/dates.py`)
- **Assessment:** the strongest-maintained fallback if fast-flights stops working, and a good reference for decoding and failure handling. Not a measurable improvement today, and it would need the full G4/G5 security review before any use. Its rating would be similar to Swoop's, with better maintenance. (Inferred)

### skillhq/flight-search (https://github.com/skillhq/flight-search)
- MIT, about 35 stars, last commit `49ed0d291fef933d52e3722e1e99ec710786f01d` (2026-04-13), no releases. (Verified)
- Files: `SKILL.md`, `references/interaction-patterns.md`, `README.md`, `LICENSE`, `.github/workflows/publish.yml` (auto-publish to ClawHub). **No executable code.** (Verified)
- How it works: instructions for Claude to drive a real browser through the `agent-browser` CLI (`allowed-tools: Bash(agent-browser:*)`) and read Google Flights pages. It defaults to economy for domestic trips, extracts booking links, never completes a purchase, and keeps no price history. (Verified)
- **Fit for Powder Fares: manual fare verification only** (section 6, improvement 8), and no better than checking google.com/travel/flights by hand in a browser. It's slow, interactive, and needs the separate `agent-browser` tool, which wasn't reviewed. Not suitable for scheduled scanning. (Inferred)

### Updated matrix rows (same scale as section 5)
| Option | Reliability | Maintainability | Functionality fit | Security | Cost | Integration effort (5 = least) |
|---|---|---|---|---|---|---|
| FlightClaw connector (Duffel) | 4? | 3 | 2 (booking-oriented; bulk use unknown) | 3 (third-party account, identity data) | 3 (search free; booking fees) | 2 |
| fli | 3? | 4 | 3 | 2 (gate not run) | 5 | 2 |
| skillhq/flight-search | 2 | 3 | 1 (manual only) | 3 (instructions only; `agent-browser` unreviewed) | 5 | 3 |

"?" = untested under Powder Fares' scheduled workload.

### Sources (addendum)
- https://flightclaw.com/claude-code (retrieved 2026-11-19).
- https://github.com/flightclaw/agents at `7df2e70fd90d`.
- https://github.com/punitarani/fli at `af5d0ed82a8c` (`fli/search/client.py`, `fli/search/dates.py`, `fli/models/google_flights/dates.py`, file tree).
- https://github.com/skillhq/flight-search at `49ed0d291fef933d52e3722e1e99ec710786f01d` (`SKILL.md`, file tree).
