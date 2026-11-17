"""Snow outlook per resort from Open-Meteo (free, no key).

1. climate  - 10 past seasons of daily snow depth + snowfall -> typical conditions per calendar day
              (computed once; --refresh-climate to redo)
2. season   - this season's snow depth now vs the 10-year normal for today
3. forecast - next 16 days of snowfall and snow depth

Writes store/snow/{climate,season,forecast}.json.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "store" / "snow"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
SEASONS = range(2015, 2025)  # 2015-16 ... 2024-25
GOOD_BASE_M = 0.75           # base depth that counts as reliably good coverage


def get(url: str, params: dict, tries: int = 3) -> dict:
    full = url + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(full, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print(f"  retry {i + 1}: {e}")
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"failed: {full}")


def loc(r: dict) -> dict:
    return {"latitude": r["lat"], "longitude": r["lon"], "elevation": r["elev_m"], "timezone": "auto"}


def climate(r: dict) -> dict[str, list[float]]:
    """{"MM-DD": [mean depth m, mean snowfall cm, share of seasons with a good base]} for Nov 15 - Apr 30."""
    by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for y in SEASONS:  # one season per request keeps responses small
        d = get(ARCHIVE, {**loc(r), "start_date": f"{y}-11-15", "end_date": f"{y + 1}-04-30",
                          "daily": "snowfall_sum,snow_depth_mean"})["daily"]
        for day, sf, sd in zip(d["time"], d["snowfall_sum"], d["snow_depth_mean"]):
            if sf is not None and sd is not None:
                by_day[day[5:]].append((sd, sf))
        time.sleep(0.3)
    return {md: [round(mean(v[0] for v in vals), 2), round(mean(v[1] for v in vals), 1),
                 round(sum(v[0] >= GOOD_BASE_M for v in vals) / len(vals), 2)]
            for md, vals in sorted(by_day.items())}


def recent_and_forecast(r: dict) -> dict[str, list[float]]:
    """{day: [snowfall cm, max snow depth m]} for the past 7 days and next 16."""
    d = get(FORECAST, {**loc(r), "daily": "snowfall_sum", "hourly": "snow_depth",
                       "past_days": 7, "forecast_days": 16})
    depth: dict[str, float] = {}
    for t, v in zip(d["hourly"]["time"], d["hourly"]["snow_depth"]):
        if v is not None:
            depth[t[:10]] = max(depth.get(t[:10], 0), v)
    return {day: [sf or 0, round(depth.get(day, 0), 2)] for day, sf in zip(d["daily"]["time"], d["daily"]["snowfall_sum"])}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-climate", action="store_true")
    ap.add_argument("--only", default="", help="comma list of resort ids (testing)")
    ap.add_argument("--skip-forecast", action="store_true")
    args = ap.parse_args()

    resorts = json.loads((ROOT / "data" / "resorts.json").read_text())["resorts"]
    if args.only:
        resorts = [r for r in resorts if r["id"] in args.only.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)
    clim_path = OUT / "climate.json"
    clim = json.loads(clim_path.read_text()) if clim_path.exists() else {}

    for r in resorts:
        if args.refresh_climate or r["id"] not in clim:
            print(f"climate {r['id']}")
            clim[r["id"]] = climate(r)
            time.sleep(1)
    clim_path.write_text(json.dumps(clim, separators=(",", ":")))

    if args.skip_forecast:
        return
    today = date.today().isoformat()
    season, fc = {}, {}
    for r in resorts:
        try:
            days = recent_and_forecast(r)
        except RuntimeError as e:
            print(f"forecast {r['id']} failed: {e}")
            continue
        fc[r["id"]] = {k: v for k, v in days.items() if k >= today}
        past = [v[1] for k, v in sorted(days.items()) if k <= today]
        normal = clim.get(r["id"], {}).get(today[5:])
        season[r["id"]] = {"date": today, "depth_m": past[-1] if past else None,
                           "normal_m": normal[0] if normal else None,
                           "snow_7d_cm": round(sum(v[0] for k, v in days.items() if k <= today), 1)}
        time.sleep(0.5)
    (OUT / "season.json").write_text(json.dumps(season, separators=(",", ":")))
    (OUT / "forecast.json").write_text(json.dumps(fc, separators=(",", ":")))
    print(f"snow done: {len(clim)} climate, {len(season)} season/forecast")


if __name__ == "__main__":
    main()
