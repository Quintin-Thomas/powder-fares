# Powder Fares

A ski-pass trip finder. Choose a pass (Ikon, Ikon Base, Epic, Epic Local) and see every fly-to mountain on it with:
- **the real round-trip cost from LAX/SNA**: Google Flights fares plus the snowboard-bag fee, with any airline excludable (Frontier by default)
- **buy timing**: whether today's fare is low, typical or high compared with Google's 60-day history for that route and date
- **snow outlook**: an A–F grade for that week (from a 0–100 rank), based on 10 past seasons (Open-Meteo), with the 16-day forecast once the dates are in range

## How it runs
A GitHub Action runs twice a day (`.github/workflows/daily.yml`):
1. `snow.py`: builds the snow climatology once, then refreshes this season's base and the 16-day forecast
2. `scan.py`: searches up to 350 of the most overdue (origin, airport, date window) combinations and saves the cheapest fare per airline. Trips within 30 days are rechecked every 2 days, trips 31–75 days out every 4 days, and later trips weekly. Steady state is about 550 searches a day, and Google's 60-day history fills the days between checks
3. `build.py`: merges everything into `site/data.json`
4. commits `store/` and publishes `site/` to GitHub Pages

## El Niño / La Niña
`snow.py` reads this winter's El Niño/La Niña status live from NOAA's ENSO discussion each run (`data/enso.json` is only a fallback). It also reads NOAA's Oceanic Niño Index to pick past winters like this one (for 2026-27, strong El Niño: 1982-83, 1991-92, 1997-98, 2015-16 and 2023-24). It also backfills 45 winters of Dec–Mar snowfall per resort (`store/snow/winters.json`, 12 resorts per run because of Open-Meteo's free limits). Each resort's El Niño effect compares those winters with all winters since 1980. The snow score uses half of that effect, capped at ±25%, because a few winters is a small sample. A real 16-day forecast replaces it once a trip is in range.

## Multi-mountain trips
Find trips → **Multi-mountain** shows 5- and 7-night trips that cover several resorts, e.g. fly into Vancouver, ski Sun Peaks and SilverStar, then fly home from Kelowna.
- **Itineraries** (`data/clusters.json`) are hand-picked. A *cluster* is a region, a *variant* is a specific itinerary (exactly which night is lodged where, which days are ski days, and which are drive days), and a *travel mode* is either an open-jaw (into A, home from B) or a round trip into the hub. Each mode has its full ground route, including both airport drives. Drive times come from OSRM road routing (free-flow, with winter-pass cautions noted).
- **Pass check on actual ski dates.** Blackouts and day limits are applied to the days you'd ski, not the nights. A trip appears only if at least 2 resorts are on your pass for those days. Unverified access is labelled.
- **Both flight options are priced.** The round trip comes from the existing scan; open-jaw uses one-way legs (`store/quotes/ow/`), each shared by every cluster that needs it. The card shows "estimated flights + board bag" for both, the flight-only difference, the extra driving, and what isn't included (rental car, one-way drop fees, fuel, lodging, lift tickets). A missing or stale leg never produces a total. One-way legs keep flight times, so late landings before a long drive and pre-dawn departures are flagged.
- **Snow per ski day.** Each day is rated against every resort-day, then averaged over the days you actually ski. That way a 1-day stop and a 4-day stop are on the same scale.
- **Budget.** Single-mountain searches always come first, and multi-mountain units only use what's left (about 46 extra searches a day). `scan.py --dry-run` prints the unique unit counts.
- The logic is in `site/cluster-core.js` and tested in `tests/cluster-cases.js` (fixture quotes, plus a consistency check on every itinerary in `clusters.json`).

## Data
- `data/resorts.json`: 95 fly-to US and Canadian resorts, with pass access by tier, nearest airports and drive times
- `data/passes.json`: passes, prices and blackout dates (2026-27)
- `data/airlines.json`: board-bag fees and default exclusions
- `pricing/`: price-source interface plus the Google Flights implementation, which can be swapped for a paid API

## Limits
Prices are estimates scraped from Google Flights and can change. Bag fees are typical 2026 values. Snow depths from weather models run low in coastal ranges, so the score is relative. Pass access entries flagged `verify` still need confirming on ikonpass.com or epicpass.com.

Run locally: `pip install -r requirements.txt && python scan.py --budget 20 && python snow.py && python build.py`, then serve `site/`.
