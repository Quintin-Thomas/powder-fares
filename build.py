"""Merge scans + snow + pass data into site/data.json for the static page."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent
DATA, STORE, SITE = ROOT / "data", ROOT / "store", ROOT / "site"


def load(p: Path, default):
    return json.loads(p.read_text()) if p.exists() else default


def days(d: str, r: str) -> list[date]:
    a, b = date.fromisoformat(d), date.fromisoformat(r)
    return [a + timedelta(n) for n in range((b - a).days + 1)]


def enso_effect(winters: dict[str, float], analogs: list[int]) -> dict | None:
    """How much more/less Dec-Mar snow this resort got in winters like this one vs all winters.

    Damped halfway toward zero and capped at ±25%, because a handful of analog winters is a small sample.
    """
    if not winters or not analogs:
        return None
    alls = list(winters.values())
    picks = [winters[str(y)] for y in analogs if str(y) in winters]
    if len(picks) < 3 or not sum(alls):
        return None
    raw = (sum(picks) / len(picks)) / (sum(alls) / len(alls)) - 1
    damped = max(-0.25, min(0.25, raw / 2))
    return {"raw_pct": round(raw * 100), "pct": round(damped * 100), "factor": 1 + damped, "n": len(picks), "of": len(alls)}


def snow_raw(clim: dict, fc: dict, d: str, r: str) -> dict | None:
    """Typical base depth and fresh snow (window + 5 days before) from climate; forecast if in range."""
    if not clim:
        return None
    span = days(d, r)
    pre = [date.fromisoformat(d) - timedelta(n) for n in range(1, 6)]
    rows = [clim.get(x.strftime("%m-%d")) for x in span]
    rows = [x for x in rows if x]
    if not rows:
        return None
    fresh_days = [clim.get(x.strftime("%m-%d")) for x in pre + span]
    out = {"depth": round(sum(x[0] for x in rows) / len(rows), 2),
           "fresh": round(sum(x[1] for x in fresh_days if x), 1),
           "reliable": round(sum(x[2] for x in rows) / len(rows), 2)}
    f = [fc.get(x.isoformat()) for x in pre + span]
    if fc and all(f):  # whole window inside the 16-day forecast
        out["forecast_fresh"] = round(sum(x[0] for x in f), 1)
        out["forecast_depth"] = max(x[1] for x in f)
    return out


def day_metric(clim: dict, mmdd_day: date, factor: float = 1.0) -> float | None:
    """One ski day's historical conditions: typical base that day + usual new snow over the 6 days up to it.

    Used for multi-mountain trips so a 1-day stop and a 4-day stop are scored on the same per-day scale."""
    row = clim.get(mmdd_day.strftime("%m-%d"))
    if not row:
        return None
    fresh = sum((clim.get((mmdd_day - timedelta(n)).strftime("%m-%d")) or [0, 0])[1] for n in range(6)) * factor
    return min(row[0] / 2.5, 1) * 0.6 + min(fresh / 40, 1) * 0.4


def day_snow(resorts: list[dict], clim: dict, effects: dict, keep: set[str]) -> dict:
    """Percentile (0-100) of each resort-day, ranked against every resort-day Dec 1 - Apr 30; kept for `keep`."""
    yr = 2027  # any non-leap reference year; only month-day matters
    days_ = [date(yr - 1, 12, 1) + timedelta(n) for n in range((date(yr, 4, 30) - date(yr - 1, 12, 1)).days + 1)]
    vals = {}
    for r in resorts:
        c = clim.get(r["id"])
        if not c:
            continue
        f = (effects.get(r["id"]) or {}).get("factor", 1.0)
        for d in days_:
            m = day_metric(c, d, f)
            if m is not None:
                vals[(r["id"], d.strftime("%m-%d"))] = m
    ranked = sorted(vals.values())
    import bisect
    out: dict[str, dict] = {}
    for (rid, md), m in vals.items():
        if rid in keep:
            out.setdefault(rid, {})[md] = round(100 * bisect.bisect_right(ranked, m) / len(ranked))
    return out


def main() -> None:
    resorts = load(DATA / "resorts.json", {})["resorts"]
    passes = load(DATA / "passes.json", {})
    airlines = load(DATA / "airlines.json", {})
    clim = load(STORE / "snow" / "climate.json", {})
    enso_meta = load(STORE / "snow" / "enso_meta.json", {})
    winters = load(STORE / "snow" / "winters.json", {})
    effects = {r["id"]: enso_effect(winters.get(r["id"], {}), enso_meta.get("analogs", [])) for r in resorts}
    season = load(STORE / "snow" / "season.json", {})
    fcast = load(STORE / "snow" / "forecast.json", {})
    today = date.today().isoformat()

    routes, cluster_routes = {}, {}
    for qf in sorted((STORE / "quotes").glob("*.json")):
        pair = qf.stem
        quotes, hist = load(qf, {}), load(STORE / "history" / qf.name, {})
        wins, cwins = {}, {}
        for wkey, q in quotes.items():
            d, r = wkey.split("|")
            if d <= today:
                continue
            if (date.fromisoformat(r) - date.fromisoformat(d)).days != 3:  # 5/7-night multi-mountain windows
                cwins[wkey] = {k: q.get(k) for k in ("checked", "url", "by_airline", "currency")}
                continue
            g = [v for k, v in sorted(hist.get(wkey, {}).get("google", {}).items())][-60:]
            fares = [v[0] for v in q["by_airline"].values()]
            fare_level = None
            if g and fares:
                cur, lo, med = min(fares), min(g), median(g)
                fare_level = "low" if cur <= lo * 1.03 else "high" if cur > med * 1.15 else "typical"
            wins[wkey] = {"checked": q["checked"], "url": q["url"], "by_airline": q["by_airline"],
                          "typical": q["typical"], "fare_level": fare_level,
                          "g60": [min(g), round(median(g)), max(g)] if g else None,
                          "spark": g[::3]}
        routes[pair] = wins
        if cwins:
            cluster_routes[pair] = cwins

    # Snow score 0-100: rank of (typical base + fresh snow) across every resort x window.
    raw = {}
    all_windows = sorted({w for wins in routes.values() for w in wins})
    for r in resorts:
        for w in all_windows:
            s = snow_raw(clim.get(r["id"]), fcast.get(r["id"], {}), *w.split("|"))
            if s:
                eff = effects.get(r["id"])
                if eff and "forecast_fresh" not in s:  # a real forecast beats the El Niño tendency
                    s["fresh"] = round(s["fresh"] * eff["factor"], 1)
                raw[(r["id"], w)] = s
    metric = {k: min(v["depth"] / 2.5, 1) * 0.6 + min(v["fresh"] / 60, 1) * 0.4 for k, v in raw.items()}
    ranked = sorted(metric.values())
    for k, v in raw.items():
        v["score"] = round(100 * sum(x <= metric[k] for x in ranked) / len(ranked))

    # Multi-mountain trips: one-way legs, cluster definitions and per-ski-day snow.
    oneway = {}
    for qf in sorted((STORE / "quotes" / "ow").glob("*.json")):
        legs = {d: {k: q.get(k) for k in ("checked", "url", "by_airline", "currency")}
                for d, q in load(qf, {}).items() if d > today}
        if legs:
            oneway[qf.stem] = legs
    clusters = load(DATA / "clusters.json", {"clusters": []})
    pool = {s["resort"] for c in clusters["clusters"] for v in c["variants"] for s in v["stops"]}

    out_resorts = []
    for r in resorts:
        snow = {w: raw[(r["id"], w)] for w in all_windows if (r["id"], w) in raw}
        out_resorts.append({**{k: r[k] for k in ("id", "name", "region", "airports", "access")},
                            "verify": r.get("verify", []), "snow": snow, "season": season.get(r["id"]),
                            "enso": {k: v for k, v in (effects.get(r["id"]) or {}).items() if k != "factor"} or None})

    data = {"generated": datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z"), "season": passes.get("season"),
            "passes": passes.get("passes", []), "products": passes.get("products", []),
            "sources": passes.get("sources", []),
            "tickets": load(DATA / "tickets.json", {}).get("prices", {}),
            "airlines": {"fees": airlines.get("board_bag_fee", {}), "default_fee": airlines.get("default_fee", 50),
                         "default_exclude": airlines.get("default_exclude", []),
                         "exclude_reasons": airlines.get("exclude_reasons", {})},
            "origins": sorted({p.split("-")[0] for p in routes}), "routes": routes, "resorts": out_resorts,
            "clusters": clusters.get("clusters", []), "drives": clusters.get("drives", {}),
            "drive_cautions": clusters.get("drive_cautions", {}), "drive_source": clusters.get("drive_source"),
            "places": clusters.get("places", {}),
            "cluster_routes": cluster_routes, "oneway": oneway, "day_snow": day_snow(resorts, clim, effects, pool),
            "enso": enso_meta or None, "health": load(STORE / "last_scan.json", None)}
    SITE.mkdir(exist_ok=True)
    (SITE / "data.json").write_text(json.dumps(data, separators=(",", ":")))
    n = sum(len(w) for w in routes.values())
    print(f"built site/data.json: {len(routes)} routes, {n} windows, {len(out_resorts)} resorts, {len(raw)} snow cells; "
          f"{len(clusters.get('clusters', []))} multi-mountain clusters, {sum(map(len, oneway.values()))} one-way legs")


if __name__ == "__main__":
    main()
