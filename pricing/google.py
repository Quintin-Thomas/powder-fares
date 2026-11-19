"""Google Flights price source (unofficial: reads the public results page via fast-flights).

Fixes over plain fast-flights:
- merges Google's "top flights" block, which fast-flights skips and which often holds the cheapest fare
- returns Google's price insights: typical range and ~60 days of daily price history
- backs off when Google signals throttling: a burst of status-13 errors ("google_error") triggers one
  multi-minute pause instead of quick retries (at most a couple per run; scan.py still stops after
  15 failed searches in a row)
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime

from fast_flights import FlightQuery, Passengers, create_query, fetch_flights_html
from fast_flights.parser import parse_js
from selectolax.lexbor import LexborHTMLParser

from .source import Itinerary, Quote, SearchResult


class GoogleFlights:
    name = "google"

    def __init__(self, currency: str = "USD", pause: float = 2.0, attempts: int = 3, log=print,
                 cooldown: float = 300.0, burst: int = 3, burst_window: float = 120.0, max_cooldowns: int = 2,
                 clock=time.monotonic, sleep=time.sleep):
        self.currency, self.pause, self.attempts, self.log = currency, pause, attempts, log
        # Throttle handling: `burst` google_errors within `burst_window` seconds -> pause `cooldown` seconds.
        self.cooldown, self.burst, self.burst_window, self.max_cooldowns = cooldown, burst, burst_window, max_cooldowns
        self.clock, self.sleep = clock, sleep
        self.cooldowns = 0  # pauses taken this run, for scan health
        self._recent: list[float] = []  # times of recent google_errors
        self.proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        self.errors: dict[str, int] = {}  # failed attempts by kind, for scan health
        self.samples: list[dict] = []  # first few failures, kept small

    def _query(self, it: Itinerary):
        legs = [FlightQuery(date=it.depart.isoformat(), from_airport=it.origin, to_airport=it.dest)]
        if it.ret:
            legs.append(FlightQuery(date=it.ret.isoformat(), from_airport=it.dest, to_airport=it.origin))
        return create_query(flights=legs, trip="round-trip" if it.ret else "one-way",
                            seat="economy", passengers=Passengers(adults=1),
                            currency=self.currency, language="en")

    def search(self, it: Itinerary) -> SearchResult | None:
        q = self._query(it)
        for i in range(self.attempts):
            try:
                html = fetch_flights_html(q, proxy=self.proxy)
                payload = _payload(html)
                merged = [k for k in [*((payload[2] or [[]])[0] or []), *((payload[3] or [[]])[0] or [])]
                          if _has_price(k)]  # one priceless listing would otherwise crash the whole page
                payload[3] = [merged or None, *(payload[3] or [None])[1:]]
                flights = parse_js("data:" + json.dumps(payload) + ",0")
                quotes = [Quote(price=f.price, airlines=list(f.airlines), stops=len(f.flights) - 1,
                                depart_time=_hhmm(f.flights[0].departure) if f.flights else None,
                                arrive_time=_hhmm(f.flights[-1].arrival) if f.flights else None)
                          for f in flights if f.price and f.price > 0]
                self.sleep(self.pause)
                return SearchResult(itinerary=it, quotes=quotes, url=q.url(), currency=self.currency, **_insights(payload))
            except Exception as e:  # network hiccups, throttling, page changes
                self.log(f"  {it.key()} attempt {i + 1} failed: {type(e).__name__}: {e}")
                kind = e.kind if isinstance(e, PageError) else \
                    "timeout" if "timeout" in type(e).__name__.lower() or "timed out" in str(e).lower() else type(e).__name__
                self.errors[kind] = self.errors.get(kind, 0) + 1
                if len(self.samples) < 5:  # a few small samples for the scan health file, to diagnose new failure kinds
                    self.samples.append({"route": it.key(), "kind": kind, "detail": str(e)[:300]})
                if kind == "bot_check":
                    break  # Google wants us to slow down: don't retry this one, move on after the pause
                if kind == "google_error" and self._throttled():
                    continue  # already paused for minutes; no extra backoff before the next attempt
                self.sleep(5 * (i + 1))
        self.sleep(self.pause * 4)
        return None

    def _throttled(self) -> bool:
        """Record a google_error; on a burst, pause once for `cooldown` seconds. True if it paused."""
        now = self.clock()
        self._recent = [t for t in self._recent if now - t <= self.burst_window] + [now]
        if len(self._recent) < self.burst or self.cooldowns >= self.max_cooldowns:
            return False
        self.cooldowns += 1
        self._recent = []
        self.log(f"  Google is throttling (status 13 x{self.burst} in {self.burst_window:.0f}s): "
                 f"pausing {self.cooldown / 60:.0f} min ({self.cooldowns} of {self.max_cooldowns} this run)")
        self.sleep(self.cooldown)
        return True


class PageError(ValueError):
    """Google answered, but not with flight results. kind: bot_check | google_error | no_results_block | unreadable."""

    def __init__(self, kind: str, msg: str):
        super().__init__(msg)
        self.kind = kind


def _has_price(k) -> bool:
    """A results entry looks like [flight info, [[None, price], ...]]; "price unavailable" entries lack the price."""
    try:
        return isinstance(k[1][0][1], (int, float))
    except (TypeError, IndexError):
        return False


def _payload(html: str):
    """The flight-results JSON from Google's ds:1 script, or a PageError saying why there isn't one."""
    tree = LexborHTMLParser(html)
    node = tree.css_first(r"script.ds\:1")
    if node is None:
        title = (tree.css_first("title").text() if tree.css_first("title") else "").strip()
        if title.lower().startswith("verifying"):
            raise PageError("bot_check", "Google bot check page instead of results")
        raise PageError("no_results_block", f"no results block (page title {title[:60]!r}, {len(html)} bytes)")
    text = node.text()
    if "errorHasStatus: true" in text:
        # Google returns this instead of data when it has no answer for the search (no flights, or try later).
        raise PageError("google_error", f"Google returned an error status: {text[:160]!r}")
    start = text.find("data:")
    if start < 0:
        raise PageError("unreadable", f"results block without data: {text[:160]!r}")
    try:
        # Read exactly one JSON value; whatever follows it (sideChannel, etc.) is ignored.
        payload, _ = json.JSONDecoder().raw_decode(text[start + 5:].lstrip())
    except json.JSONDecodeError as e:
        raise PageError("unreadable", f"results JSON unreadable ({e.msg} at {e.pos}): {text[:160]!r}") from None
    if not isinstance(payload, list):
        raise PageError("unreadable", f"unexpected results shape: {type(payload).__name__}")
    return payload


def _hhmm(t) -> str | None:
    """SimpleDatetime -> "HH:MM" (local airport time), or None if Google left it out."""
    try:
        h, m = (list(t.time) + [0, 0])[:2]
        return f"{int(h):02d}:{int(m or 0):02d}"
    except (TypeError, ValueError, AttributeError):
        return None


def _insights(payload) -> dict:
    """Google's price-insight block (payload[5]); field meanings inferred from live pages."""
    try:
        ins = payload[5]
        history = {datetime.fromtimestamp(ms / 1000).date().isoformat(): int(p)
                   for ms, p in (ins[10][0] if len(ins) > 10 and ins[10] else [])}
        return {"typical_low": ins[4][1], "typical_high": ins[5][1], "typical": ins[2][1], "history": history}
    except (TypeError, IndexError, KeyError):
        return {"typical_low": None, "typical_high": None, "typical": None, "history": {}}


def _demo() -> None:
    src = GoogleFlights()
    r = src.search(Itinerary("LAX", "DEN", date(2027, 1, 25), date(2027, 1, 28)))
    print(r and (r.cheapest().price, r.typical_low, r.typical_high, len(r.history)))


if __name__ == "__main__":
    _demo()
