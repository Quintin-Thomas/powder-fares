"""Scan round-trip fares from origins to every resort airport, a few hundred searches per run.

Unit of work = (origin, airport, date window). Units are shared by every resort and pass that
uses the airport. Each run searches the stalest units first, up to --budget.

Stores (git is the database):
  store/quotes/<ORIGIN>-<AIRPORT>.json   latest result per window: cheapest fare per airline
  store/history/<ORIGIN>-<AIRPORT>.json  per window: our daily lows + Google's all-airline history
  store/scan_state.json                  last time each unit was searched
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pricing import GoogleFlights, Itinerary

ROOT = Path(__file__).resolve().parent
DATA, STORE = ROOT / "data", ROOT / "store"
CONFIG = {
    "origins": ["LAX", "SNA"],
    "season": ["2027-01-04", "2027-04-25"],
    # How often to re-search a window, by days until departure: (max days out, refresh every N days)
    "refresh": [(30, 2), (75, 4), (10_000, 7)],
    # (depart weekday, nights): Mon-Thu midweek and Thu-Sun weekend trips
    "window_shapes": [(0, 3), (3, 3)],
}
AIRLINES = json.loads((DATA / "airlines.json").read_text())


def log(msg: str) -> None:
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


def windows(today: date) -> list[tuple[date, date]]:
    start, end = (date.fromisoformat(d) for d in CONFIG["season"])
    out, d = [], max(start, today + timedelta(days=1))
    while d <= end:
        for wd, nights in CONFIG["window_shapes"]:
            if d.weekday() == wd:
                out.append((d, d + timedelta(days=nights)))
        d += timedelta(days=1)
    return out


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
    args = ap.parse_args()

    resorts = json.loads((DATA / "resorts.json").read_text())["resorts"]
    airports = sorted({a["code"] for r in resorts for a in r["airports"]})
    if args.airports:
        airports = [a for a in airports if a in args.airports.split(",")]
    today = date.today()
    units = [(o, a, d, r) for o in args.origins.split(",") for a in airports for d, r in windows(today)]

    state = load(STORE / "scan_state.json", {})
    key = lambda u: f"{u[0]}-{u[1]}|{u[2]}|{u[3]}"  # noqa: E731
    now = datetime.now(timezone.utc)

    def overdue(u) -> float:
        """How overdue a unit is, as a multiple of its refresh interval (never searched = very overdue)."""
        last = state.get(key(u))
        if not last:
            return 1e6
        out = (u[2] - today).days
        every = next(n for limit, n in CONFIG["refresh"] if out <= limit)
        t = datetime.fromisoformat(last.replace("Z", "+00:00"))
        if t.tzinfo is None:  # older entries were saved without a zone
            t = t.replace(tzinfo=timezone.utc)
        return (now - t).total_seconds() / 86400 / every

    units.sort(key=overdue, reverse=True)
    due = [u for u in units if overdue(u) >= 1]
    todo = due[: args.budget]
    log(f"{len(units)} units total, {len(due)} due, searching {len(todo)}")
    if args.dry_run:
        need = sum(1 / next(n for lim, n in CONFIG["refresh"] if (u[2] - today).days <= lim) for u in units)
        log(f"steady state needs ~{need:.0f} searches/day")
        return 0

    src = GoogleFlights(pause=1.5, log=log)
    files: dict[str, tuple[dict, dict]] = {}
    ok = fail = 0
    for o, a, d, r in todo:
        pair = f"{o}-{a}"
        if pair not in files:
            files[pair] = (load(STORE / "quotes" / f"{pair}.json", {}), load(STORE / "history" / f"{pair}.json", {}))
        quotes, history = files[pair]
        wkey = f"{d}|{r}"
        res = src.search(Itinerary(o, a, d, r))
        state[key((o, a, d, r))] = datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z")
        if res is None:
            fail += 1
            continue
        ok += 1
        by_airline: dict[str, list[int]] = {}
        for q in res.quotes:
            name = ", ".join(q.airlines)
            if name not in by_airline or q.price < by_airline[name][0]:
                by_airline[name] = [q.price, q.stops]
        quotes[wkey] = {"checked": state[key((o, a, d, r))], "url": res.url, "by_airline": by_airline,
                        "typical": [res.typical_low, res.typical_high, res.typical]}
        # Our own daily low with the default settings (board bag on, default exclusions), plus Google's history.
        banned = set(AIRLINES["default_exclude"])
        totals = [bag_total(f, n.split(", ")) for n, (f, _) in by_airline.items()
                  if not banned & set(n.split(", "))]
        h = history.setdefault(wkey, {"ours": {}, "google": {}})
        if totals:
            h["ours"][today.isoformat()] = min(totals)
        h["google"].update(res.history)
        if ok % 25 == 0:
            log(f"progress: {ok} ok, {fail} failed")

    for pair, (quotes, history) in files.items():
        save(STORE / "quotes" / f"{pair}.json", quotes)
        save(STORE / "history" / f"{pair}.json", history)
    save(STORE / "scan_state.json", state)
    log(f"done: {ok} ok, {fail} failed")
    return 0 if ok or not todo else 1


if __name__ == "__main__":
    raise SystemExit(main())
