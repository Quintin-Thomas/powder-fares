"""Scan round-trip fares from origins to every resort airport, a few hundred searches per run.

Unit of work = (origin, airport, date window). Units are shared by every resort and pass that
uses the airport. Each run splits --budget between two queues (see pick()):
  - re-checks: windows already searched and now past their refresh interval, most overdue first,
    guaranteed up to CONFIG["refresh_share"] of the budget
  - first searches: windows never searched, earliest departure first across every origin and airport,
    so each route gets its nearest dates priced before anything further out
Budget one queue doesn't need goes to the other.

Multi-mountain trips (data/clusters.json) add two more kinds of unit, scanned only with budget left
over after the single-mountain units:
  - round trips into a cluster hub for 5- and 7-night Saturday windows
  - one-way legs for open-jaw trips (origin -> arrival airport, departure airport -> origin),
    each shared by every cluster that uses that airport and date

Stores (git is the database):
  store/quotes/<ORIGIN>-<AIRPORT>.json   latest result per window: cheapest fare per airline
  store/history/<ORIGIN>-<AIRPORT>.json  per window: our daily lows + Google's all-airline history
  store/quotes/ow/<FROM>-<TO>.json       one-way legs: {date: {checked, url, by_airline: {name: [fare, stops, dep, arr]}}}
  store/scan_state.json                  last time each unit was searched
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pricing import GoogleFlights, Itinerary

ROOT = Path(__file__).resolve().parent
DATA, STORE = ROOT / "data", ROOT / "store"
CONFIG = {
    # Departure airports. LAX only for now: it serves every resort airport, and one origin halves the
    # searches needed. Add SNA or BUR here later; build.py publishes only the origins listed here.
    "origins": ["LAX"],
    "season": ["2027-01-04", "2027-04-25"],
    # How often to re-search a window, by days until departure: (max days out, refresh every N days)
    "refresh": [(30, 2), (75, 4), (10_000, 7)],
    # Share of each run's budget kept for re-checking overdue fares while never-searched windows remain
    "refresh_share": 0.4,
    # (depart weekday, nights): Mon-Thu midweek and Thu-Sun weekend trips
    "window_shapes": [(0, 3), (3, 3)],
    # Multi-mountain trips: Sat -> Thu (5 nights) and Sat -> Sat (7 nights)
    "cluster_shapes": [(5, 5), (5, 7)],
}
AIRLINES = json.loads((DATA / "airlines.json").read_text())


def log(msg: str) -> None:
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


def windows(today: date, shapes=None) -> list[tuple[date, date]]:
    """Date windows in season that haven't started; the trip must also end by the season's last day."""
    start, end = (date.fromisoformat(d) for d in CONFIG["season"])
    out, d = [], max(start, today + timedelta(days=1))
    while d <= end:
        for wd, nights in shapes or CONFIG["window_shapes"]:
            if d.weekday() == wd and (shapes is None or d + timedelta(days=nights) <= end):
                out.append((d, d + timedelta(days=nights)))
        d += timedelta(days=1)
    return out


def cluster_units(clusters: list[dict], origins: list[str], today: date) -> list[tuple]:
    """Unique search units needed by multi-mountain trips (shared across clusters).

    ("rt", origin, hub, depart, ret) or ("ow", from, to, date, None)."""
    units = set()
    for w_d, w_r in windows(today, CONFIG["cluster_shapes"]):
        nights = (w_r - w_d).days
        for c in clusters:
            for v in c["variants"]:
                if v["nights"] != nights:
                    continue
                for m in v["travel_modes"]:
                    for o in origins:
                        if m["kind"] == "rt":
                            units.add(("rt", o, m["arrive"], w_d, w_r))
                        else:
                            units.add(("ow", o, m["arrive"], w_d, None))
                            units.add(("ow", m["depart"], o, w_r, None))
    return sorted(units, key=lambda u: (u[0], u[1], u[2], u[3]))


def unit_key(u: tuple) -> str:
    """Scan-state key. Round trips keep the original format so existing state still matches."""
    kind, a, b, d, r = u
    return f"{a}-{b}|{d}|{r}" if kind == "rt" else f"ow:{a}-{b}|{d}"


def every(u: tuple, today: date) -> int:
    """Refresh interval in days for a unit, by how far away its departure is."""
    return next(n for limit, n in CONFIG["refresh"] if (u[3] - today).days <= limit)


def overdue(u: tuple, state: dict, now: datetime, today: date) -> float:
    """How overdue a unit is, as a multiple of its refresh interval (never searched = very overdue)."""
    last = state.get(unit_key(u))
    if not last:
        return 1e6
    t = datetime.fromisoformat(last.replace("Z", "+00:00"))
    if t.tzinfo is None:  # older entries were saved without a zone
        t = t.replace(tzinfo=timezone.utc)
    return (now - t).total_seconds() / 86400 / every(u, today)


def pick(units: list[tuple], extra: list[tuple], state: dict, now: datetime, today: date, budget: int,
         share: float | None = None, multi_only: bool = False) -> tuple[list[tuple], dict]:
    """Choose this run's searches. Returns (units to search in order, counts for the log and health record).

    Single-mountain units come first, as two queues:
      re-checks     searched before and now due; most overdue first; at least `share` of the budget
                    when that many are due
      first search  never searched; earliest departure first, then origin, then airport, so every
                    route gets its nearest dates before any route gets later ones
    Whatever one queue leaves unused goes to the other. Multi-mountain units only get what is left after both.
    """
    share = CONFIG["refresh_share"] if share is None else share
    single = [] if multi_only else units
    new = sorted((u for u in single if unit_key(u) not in state), key=lambda u: (u[3], u[1], u[2]))
    due = sorted((u for u in single if unit_key(u) in state and overdue(u, state, now, today) >= 1),
                 key=lambda u: (-overdue(u, state, now, today), u[3], u[1], u[2]))
    n_due = min(len(due), round(budget * share))
    n_new = min(len(new), budget - n_due)
    n_due = min(len(due), budget - n_new)  # hand back budget the first-search queue didn't need
    todo = due[:n_due] + new[:n_new]
    multi = sorted((u for u in extra if overdue(u, state, now, today) >= 1),
                   key=lambda u: (-overdue(u, state, now, today), u[3]))  # ties (never searched): soonest first
    todo += multi[: budget - len(todo)]
    info = {"recheck_due": len(due), "recheck": n_due, "new_left": len(new), "new": n_new,
            "multi_due": len(multi), "multi": len(todo) - n_due - n_new}
    return todo, info


def bag_total(fare: int, airlines: list[str], directions: int = 2) -> int:
    fees = AIRLINES["board_bag_fee"]
    return fare + max(fees.get(a, AIRLINES["default_fee"]) for a in airlines) * directions


def load(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=300, help="max searches this run")
    ap.add_argument("--origins", default=",".join(CONFIG["origins"]))
    ap.add_argument("--airports", default="", help="comma list to restrict (testing)")
    ap.add_argument("--dry-run", action="store_true", help="only report what is due")
    ap.add_argument("--multi-only", action="store_true", help="only multi-mountain units (testing)")
    ap.add_argument("--max-minutes", type=float, default=35,
                    help="stop searching after this long, so the run saves its results before the job time limit")
    args = ap.parse_args()

    resorts = json.loads((DATA / "resorts.json").read_text())["resorts"]
    clusters = load(DATA / "clusters.json", {"clusters": []})["clusters"]
    airports = sorted({a["code"] for r in resorts for a in r["airports"]})
    only = set(args.airports.split(",")) if args.airports else None
    if only:
        airports = [a for a in airports if a in only]
    today = date.today()
    origins = args.origins.split(",")
    units = [("rt", o, a, d, r) for o in origins for a in airports for d, r in windows(today)]
    extra = [u for u in cluster_units(clusters, origins, today)
             if not only or (u[2] if u[1] in origins else u[1]) in only]

    state = load(STORE / "scan_state.json", {})
    now = datetime.now(timezone.utc)

    todo, plan = pick(units, extra, state, now, today, args.budget, multi_only=args.multi_only)
    n_ow = sum(u[0] == "ow" for u in extra)
    log(f"{len(units)} single-mountain units, {len(extra)} multi-mountain units "
        f"({len(extra) - n_ow} round trip, {n_ow} one-way, de-duplicated)")
    log(f"searching {len(todo)}: {plan['recheck']} re-checks (of {plan['recheck_due']} due), "
        f"{plan['new']} first searches (of {plan['new_left']} never searched), "
        f"{plan['multi']} multi-mountain (of {plan['multi_due']} due)")
    if args.dry_run:
        need = sum(1 / every(u, today) for u in units)
        need_x = sum(1 / every(u, today) for u in extra)
        log(f"steady state needs ~{need:.0f} searches/day for single mountains + ~{need_x:.0f} for multi-mountain trips")
        return 0

    src = GoogleFlights(pause=1.5, log=log)
    files: dict[str, tuple[dict, dict]] = {}
    ok = fail = 0
    secs: list[float] = []
    started = time.monotonic()
    done: list[tuple] = []
    streak = 0  # consecutive failed searches
    stopped_early = None

    def flush() -> None:
        for pair, (quotes, history) in files.items():
            save(STORE / "quotes" / f"{pair}.json", quotes)
            save(STORE / "history" / f"{pair}.json", history)
        save(STORE / "scan_state.json", state)

    for u in todo:
        if (time.monotonic() - started) / 60 > args.max_minutes:
            log(f"time limit ({args.max_minutes} min) reached after {len(done)} searches; the rest wait for the next run")
            break
        done.append(u)
        kind, a, b, d, r = u
        pair = f"{a}-{b}" if kind == "rt" else f"ow/{a}-{b}"
        if pair not in files:
            files[pair] = (load(STORE / "quotes" / f"{pair}.json", {}), load(STORE / "history" / f"{pair}.json", {}))
        quotes, history = files[pair]
        wkey = f"{d}|{r}" if kind == "rt" else d.isoformat()
        t0 = time.monotonic()
        res = src.search(Itinerary(a, b, d, r))
        state[unit_key(u)] = datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z")
        if res is None:
            fail += 1
            streak += 1
            if streak >= 15:  # Google is refusing us right now: stop instead of hammering it; next run resumes
                stopped_early = f"{streak} searches in a row failed"
                log(f"stopping early: {stopped_early}")
                break
            continue
        streak = 0
        ok += 1
        secs.append(time.monotonic() - t0)
        by_airline: dict[str, list] = {}
        for q in res.quotes:
            name = ", ".join(q.airlines)
            if name not in by_airline or q.price < by_airline[name][0]:
                by_airline[name] = [q.price, q.stops] + ([q.depart_time, q.arrive_time] if kind == "ow" else [])
        quotes[wkey] = {"checked": state[unit_key(u)], "url": res.url, "by_airline": by_airline,
                        "typical": [res.typical_low, res.typical_high, res.typical], "currency": res.currency}
        # Our own daily low with the default settings (board bag on, default exclusions), plus Google's history.
        banned = set(AIRLINES["default_exclude"])
        totals = [bag_total(v[0], n.split(", "), 2 if kind == "rt" else 1) for n, v in by_airline.items()
                  if not banned & set(n.split(", "))]
        h = history.setdefault(wkey, {"ours": {}, "google": {}})
        if totals:
            h["ours"][today.isoformat()] = min(totals)
        h["google"].update(res.history)
        if ok % 25 == 0:
            log(f"progress: {ok} ok, {fail} failed")
            flush()  # if the job is killed anyway, earlier results are already on disk

    flush()
    if todo:  # health record for the site footer (skipped on publish-only runs)
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)

        def recent(u) -> bool:
            t = state.get(unit_key(u))
            if not t:
                return False
            t = datetime.fromisoformat(t.replace("Z", "+00:00"))
            return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)) >= week_ago

        save(STORE / "last_scan.json", {
            "finished": datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z"),
            "searched": len(done), "planned": len(todo), "ok": ok, "failed": fail,
            "planned_rechecks": plan["recheck"], "planned_new": plan["new"], "never_searched": plan["new_left"],
            "minutes": round((time.monotonic() - started) / 60, 1),
            "multi_searched": len(set(done) & set(extra)), "attempt_errors": src.errors,
            "failure_samples": src.samples, "stopped_early": stopped_early, "cooldowns": src.cooldowns,
            "avg_seconds": round(sum(secs) / len(secs), 1) if secs else None,
            "windows_total": len(units), "windows_checked_7d": sum(map(recent, units)),
            "multi_total": len(extra), "multi_checked_7d": sum(map(recent, extra))})
    log(f"done: {ok} ok, {fail} failed")
    return 0 if ok or not todo else 1


if __name__ == "__main__":
    raise SystemExit(main())
