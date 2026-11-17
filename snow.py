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


BANDS = {"weak": (0.5, 1.0), "moderate": (1.0, 1.5), "strong": (1.5, 99)}


def fetch_text(url: str, need: str = "") -> str:
    """Fetch a page; on a cut-off download, retry and accept partial text if it contains `need`."""
    import http.client
    best = ""
    for i in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as f:
                return f.read().decode("utf-8", "replace")
        except http.client.IncompleteRead as e:
            best = max(best, e.partial.decode("utf-8", "replace"), key=len)
            if need and need in best:
                return best
            time.sleep(2 * (i + 1))
    if best:
        return best
    raise RuntimeError(f"could not fetch {url}")


def current_enso(cfg: dict) -> dict:
    """This winter's outlook, read live from NOAA's ENSO discussion (falls back to data/enso.json)."""
    import html
    import re
    try:
        page = fetch_text(cfg["discussion_url"], need="Synopsis")
        text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))
        status = re.search(r"ENSO Alert System Status:\s*(.+?)\s+Synopsis:", text).group(1).strip()
        synopsis = re.search(r"Synopsis:\s*(.+?\.)\s", text).group(1).strip()
        issued = re.search(r"issued by .*?(\d{1,2} \w+ \d{4})", text).group(1)
    except Exception as e:
        print(f"NOAA discussion unreadable ({e}); using saved outlook")
        return {**cfg["current"], "auto": False}
    low = (status + " " + synopsis).lower()
    phase = "el_nino" if "el niño" in status.lower() or "el nino" in status.lower() else \
            "la_nina" if "la niña" in status.lower() or "la nina" in status.lower() else "neutral"
    strength = "strong" if "strong" in low else "moderate" if "moderate" in low else "weak"
    label = "ENSO-neutral" if phase == "neutral" else f"{strength.title()} {'El Niño' if phase == 'el_nino' else 'La Niña'}"
    today = date.today()
    y = today.year if today.month >= 7 else today.year - 1
    return {"season": f"{y}-{str(y + 1)[2:]}", "phase": phase, "strength": strength, "label": label,
            "summary": f"NOAA ({issued}): {status}. {synopsis}", "source": cfg["discussion_url"],
            "updated": issued, "auto": True}


def analog_seasons(cfg: dict, cur: dict) -> list[int]:
    """Past winters (start year) in the same ENSO phase and strength band, from NOAA's ONI (Dec-Feb)."""
    if cur["phase"] == "neutral":
        return []
    sign = 1 if cur["phase"] == "el_nino" else -1
    try:
        lines = fetch_text(cfg["oni_url"]).splitlines()
        djf = {int(p[1]) - 1: float(p[3]) for p in (l.split() for l in lines) if len(p) == 4 and p[0] == "DJF"}
    except Exception as e:
        print(f"ONI fetch failed ({e}); using fallback analogs")
        return cfg["fallback_analogs"].get(f"{cur['phase']}_{cur['strength']}", [])
    done = {y: v * sign for y, v in djf.items() if cfg["since"] <= y < date.today().year - 1}  # completed winters
    lo, hi = BANDS[cur["strength"]]
    pick = [y for y, v in sorted(done.items()) if lo <= v < hi]
    if len(pick) < 3:  # too few in this band: use every winter of this phase
        pick = [y for y, v in sorted(done.items()) if v >= 0.5]
    return pick


def climate(r: dict, seasons=SEASONS) -> dict[str, list[float]]:
    """{"MM-DD": [mean depth m, mean snowfall cm, share of seasons with a good base]} for Nov 15 - Apr 30."""
    by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for y in seasons:  # one season per request keeps responses small
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
    ap.add_argument("--out", default=str(OUT), help="output folder (testing)")
    ap.add_argument("--winters-per-run", type=int, default=12, help="resorts to backfill 45-winter history for")
    args = ap.parse_args()
    out = Path(args.out)

    resorts = json.loads((ROOT / "data" / "resorts.json").read_text())["resorts"]
    if args.only:
        resorts = [r for r in resorts if r["id"] in args.only.split(",")]
    out.mkdir(parents=True, exist_ok=True)
    clim_path = out / "climate.json"
    clim = json.loads(clim_path.read_text()) if clim_path.exists() else {}

    for r in resorts:
        if args.refresh_climate or r["id"] not in clim:
            print(f"climate {r['id']}")
            clim[r["id"]] = climate(r)
            time.sleep(1)
    clim_path.write_text(json.dumps(clim, separators=(",", ":")))

    # Dec-Mar snowfall for every winter since 1980, so El Niño / La Niña winters can be
    # compared with all winters over the same period. Open-Meteo's free tier limits how much
    # history we can pull per day, so this fills in a few resorts per run (--winters-per-run).
    enso = json.loads((ROOT / "data" / "enso.json").read_text())
    cur = current_enso(enso)
    analogs = analog_seasons(enso, cur)
    print(f"ENSO: {cur['label']} (auto={cur['auto']}), analog winters {analogs}")
    w_path = out / "winters.json"
    winters = json.loads(w_path.read_text()) if w_path.exists() else {}
    first = enso["since"]
    last = date.today().year - 2  # last completed winter's start year
    todo = [r for r in resorts if len(winters.get(r["id"], {})) < last - first + 1][: args.winters_per_run]
    for r in todo:
        print(f"winters {r['id']} {first}-{last + 1}")
        got = winters.setdefault(r["id"], {})
        try:
            for start in range(first, last + 1, 3):  # 3 winters per request (small responses)
                end = min(start + 2, last)
                d = get(ARCHIVE, {**loc(r), "start_date": f"{start}-12-01", "end_date": f"{end + 1}-03-31",
                                  "daily": "snowfall_sum"})["daily"]
                for y in range(start, end + 1):
                    vals = [v for t, v in zip(d["time"], d["snowfall_sum"]) if f"{y}-12-01" <= t <= f"{y + 1}-03-31"]
                    got[str(y)] = round(sum(v or 0 for v in vals), 1)
                time.sleep(1)
        except RuntimeError as e:
            print(f"  stopped ({e}); will continue next run")
            break
    w_path.write_text(json.dumps(winters, separators=(",", ":")))
    (out / "enso_meta.json").write_text(json.dumps({**cur, "analogs": analogs}, indent=1))

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
    (out / "season.json").write_text(json.dumps(season, separators=(",", ":")))
    (out / "forecast.json").write_text(json.dumps(fc, separators=(",", ":")))
    print(f"snow done: {len(clim)} climate, {len(season)} season/forecast")


if __name__ == "__main__":
    main()
