# Powder Fares

A ski-pass trip finder. Choose a pass (Ikon, Ikon Base, Epic, Epic Local) and see every fly-to mountain on it with:
- **the real round-trip cost from LAX/SNA**: Google Flights fares plus the snowboard-bag fee, with Frontier skippable
- **buy timing**: whether today's fare is low, typical or high compared with Google's 60-day history for that route and date
- **snow outlook**: a 0–100 score for that week, based on 10 past seasons (Open-Meteo), with the 16-day forecast once the dates are in range

## How it runs
A GitHub Action runs every morning (`.github/workflows/daily.yml`):
1. `snow.py`: builds the snow climatology once, then refreshes this season's base and the 16-day forecast
2. `scan.py`: searches about 300 of the stalest (origin, airport, date window) combinations and saves the cheapest fare per airline
3. `build.py`: merges everything into `site/data.json`
4. commits `store/` and publishes `site/` to GitHub Pages

## Data
- `data/resorts.json`: 50 western US and Canadian resorts, with pass access by tier, nearest airports and drive times
- `data/passes.json`: passes, prices and blackout dates (2026-27)
- `data/airlines.json`: board-bag fees and default exclusions
- `pricing/`: price-source interface plus the Google Flights implementation, which can be swapped for a paid API

## Limits
Prices are estimates scraped from Google Flights and can change. Bag fees are typical 2026 values. Snow depths from weather models run low in coastal ranges, so the score is relative. Pass access entries flagged `verify` still need confirming on ikonpass.com or epicpass.com.

Run locally: `pip install -r requirements.txt && python scan.py --budget 20 && python snow.py && python build.py`, then serve `site/`.
