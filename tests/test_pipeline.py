"""Tests for the Python data pipeline. Run: python -m unittest discover tests"""

import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build  # noqa: E402
import scan  # noqa: E402
import snow  # noqa: E402
from pricing import google  # noqa: E402


def _page(script: str | None, title: str = "Google Flights") -> str:
    body = f"<script class=\"ds:1\" nonce=\"x\">{script}</script>" if script is not None else ""
    return f"<html><head><title>{title}</title></head><body>{body}</body></html>"


class GooglePageTests(unittest.TestCase):
    """Each kind of page Google can send back is recognized (minimal hand-made pages, not saved Google HTML)."""

    def test_reads_results_even_with_commas_after_the_data(self):
        p = google._payload(_page("AF_initDataCallback({key: 'ds:1', hash: '2', data:[[1,2],null,[3]], sideChannel: {a: 1, b: 2}});"))
        self.assertEqual(p, [[1, 2], None, [3]])

    def test_error_status_is_google_error_not_a_parse_crash(self):
        with self.assertRaises(google.PageError) as cm:
            google._payload(_page("AF_initDataCallback({key: 'ds:1', hash: '2', data:null, errorHasStatus: true, sideChannel: {}});"))
        self.assertEqual(cm.exception.kind, "google_error")

    def test_bot_check_page_is_recognized(self):
        with self.assertRaises(google.PageError) as cm:
            google._payload(_page(None, title="Verifying..."))
        self.assertEqual(cm.exception.kind, "bot_check")

    def test_other_page_without_results(self):
        with self.assertRaises(google.PageError) as cm:
            google._payload(_page(None, title="Before you continue"))
        self.assertEqual(cm.exception.kind, "no_results_block")

    def test_price_unavailable_listing_is_skipped(self):
        self.assertTrue(google._has_price([["UA"], [[None, 467], "token"]]))
        self.assertFalse(google._has_price([["UA"], [[None]]]))  # Google's "price unavailable"
        self.assertFalse(google._has_price([["UA"], []]))
        self.assertFalse(google._has_price([["UA"]]))

    def test_garbled_results_are_unreadable(self):
        with self.assertRaises(google.PageError) as cm:
            google._payload(_page("AF_initDataCallback({key: 'ds:1', data:[[1,2, sideChannel: {}});"))
        self.assertEqual(cm.exception.kind, "unreadable")


class ScanTests(unittest.TestCase):
    def test_windows_are_mon_thu_and_thu_sun_in_season(self):
        wins = scan.windows(date(2026, 11, 16))
        self.assertTrue(wins)
        for d, r in wins:
            self.assertIn(d.weekday(), (0, 3))
            self.assertEqual((r - d).days, 3)
            self.assertGreaterEqual(d.isoformat(), scan.CONFIG["season"][0])
            self.assertLessEqual(d.isoformat(), scan.CONFIG["season"][1])

    def test_no_windows_in_the_past(self):
        self.assertTrue(all(d > date(2027, 2, 1) for d, _ in scan.windows(date(2027, 2, 1))))

    def test_bag_fee_both_ways_uses_priciest_airline(self):
        self.assertEqual(scan.bag_total(200, ["Delta"]), 200 + 2 * 45)
        self.assertEqual(scan.bag_total(200, ["Flair Airlines"]), 200 + 2 * 85)
        self.assertEqual(scan.bag_total(200, ["Delta", "Flair Airlines"]), 200 + 2 * 85)
        self.assertEqual(scan.bag_total(200, ["Unknown Air"]), 200 + 2 * scan.AIRLINES["default_fee"])

    def test_one_way_bag_fee_counts_once(self):
        self.assertEqual(scan.bag_total(150, ["Flair Airlines"], 1), 150 + 85)


class ClusterScanTests(unittest.TestCase):
    CLUSTERS = [
        {"id": "a", "variants": [
            {"nights": 5, "travel_modes": [{"kind": "oj", "arrive": "YVR", "depart": "YLW"}, {"kind": "rt", "arrive": "YVR", "depart": "YVR"}]},
            {"nights": 7, "travel_modes": [{"kind": "oj", "arrive": "YVR", "depart": "YLW"}]}]},
        {"id": "b", "variants": [  # shares the YVR outbound legs with cluster a
            {"nights": 5, "travel_modes": [{"kind": "oj", "arrive": "YVR", "depart": "YYC"}]}]},
    ]

    def test_cluster_windows_are_saturdays_and_end_in_season(self):
        wins = scan.windows(date(2026, 11, 16), scan.CONFIG["cluster_shapes"])
        self.assertTrue(wins)
        for d, r in wins:
            self.assertEqual(d.weekday(), 5)
            self.assertIn((r - d).days, (5, 7))
            self.assertLessEqual(r.isoformat(), scan.CONFIG["season"][1])

    def test_one_way_units_are_shared_across_clusters(self):
        units = scan.cluster_units(self.CLUSTERS, ["LAX"], date(2026, 11, 16))
        self.assertEqual(len(units), len(set(units)))
        sats = {d for d, _ in scan.windows(date(2026, 11, 16), scan.CONFIG["cluster_shapes"])}
        outbound = [u for u in units if u[0] == "ow" and u[1:3] == ("LAX", "YVR")]
        self.assertEqual(len(outbound), len(sats))  # one per Saturday, not one per cluster/variant
        self.assertTrue(any(u[0] == "ow" and u[1:3] == ("YYC", "LAX") for u in units))
        self.assertTrue(all(u[4] is None for u in units if u[0] == "ow"))

    def test_round_trip_state_keys_unchanged(self):
        u = ("rt", "LAX", "DEN", date(2027, 1, 4), date(2027, 1, 7))
        self.assertEqual(scan.unit_key(u), "LAX-DEN|2027-01-04|2027-01-07")  # same as before multi-mountain trips
        self.assertEqual(scan.unit_key(("ow", "YLW", "LAX", date(2027, 1, 14), None)), "ow:YLW-LAX|2027-01-14")


class DaySnowTests(unittest.TestCase):
    def test_day_snow_is_percentile_per_day(self):
        flat = {f"{m:02d}-{d:02d}": [1.0, 2.0, 1.0] for m in (12, 1, 2, 3, 4) for d in range(1, 32)}
        deep = {k: [2.5, 10.0, 1.0] for k in flat}
        out = build.day_snow([{"id": "flat"}, {"id": "deep"}], {"flat": flat, "deep": deep}, {}, {"flat", "deep"})
        self.assertEqual(out["deep"]["02-10"], 100)
        self.assertLess(out["flat"]["02-10"], 60)


class SnowTests(unittest.TestCase):
    def test_enso_effect_is_damped_and_capped(self):
        winters = {str(y): 100.0 for y in range(1980, 2025)}
        for y in (1982, 1997, 2015):
            winters[str(y)] = 200.0
        eff = build.enso_effect(winters, [1982, 1997, 2015])
        self.assertGreater(eff["raw_pct"], 50)
        self.assertEqual(eff["pct"], 25)  # half the raw effect, capped at +25%

    def test_enso_effect_needs_three_analog_winters(self):
        self.assertIsNone(build.enso_effect({"1982": 100.0, "1983": 90.0}, [1982]))

    def test_noaa_status_parsing(self):
        cfg = {"discussion_url": "x", "current": {"label": "fallback"}}
        page = ("<p>issued by CLIMATE PREDICTION CENTER/NCEP/NWS 10 December 2026</p>"
                "<p>ENSO Alert System Status: La Ni&ntilde;a Watch</p><p>Synopsis: A weak La Ni&ntilde;a is favored. More.</p>")
        orig = snow.fetch_text
        snow.fetch_text = lambda url, need="": page
        try:
            cur = snow.current_enso(cfg)
        finally:
            snow.fetch_text = orig
        self.assertEqual((cur["phase"], cur["strength"], cur["auto"]), ("la_nina", "weak", True))


class ScanPickTests(unittest.TestCase):
    """Which searches a run makes: overdue re-checks keep a share of the budget while new windows fill in."""

    TODAY = date(2026, 11, 18)
    NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)

    def units(self, airports=("BZN", "DEN", "SLC"), origins=("LAX", "SNA")):
        return [("rt", o, a, d, r) for o in origins for a in airports for d, r in scan.windows(self.TODAY)]

    def stamp(self, days_ago):
        return (self.NOW - timedelta(days=days_ago)).isoformat(timespec="minutes").replace("+00:00", "Z")

    def test_overdue_rechecks_keep_their_share_despite_a_new_window_backlog(self):
        units = self.units()
        old = [u for u in units if u[1] == "LAX" and u[2] == "BZN"]  # all 7-day or 4-day windows, 9 days old
        state = {scan.unit_key(u): self.stamp(9) for u in old}
        todo, info = scan.pick(units, [], state, self.NOW, self.TODAY, budget=20, share=0.4)
        self.assertEqual(len(todo), 20)
        self.assertEqual(info["recheck"], 8)
        self.assertEqual(info["new"], 12)
        self.assertEqual(sum(scan.unit_key(u) in state for u in todo), 8)

    def test_unused_recheck_budget_goes_to_new_windows_and_back(self):
        units = self.units()
        state = {scan.unit_key(units[0]): self.stamp(30)}  # one overdue fare
        todo, info = scan.pick(units, [], state, self.NOW, self.TODAY, budget=20, share=0.4)
        self.assertEqual((info["recheck"], info["new"], len(todo)), (1, 19, 20))
        # nothing left to search for the first time: the whole budget goes to re-checks
        state = {scan.unit_key(u): self.stamp(30) for u in units}
        todo, info = scan.pick(units, [], state, self.NOW, self.TODAY, budget=20, share=0.4)
        self.assertEqual((info["recheck"], info["new"], len(todo)), (20, 0, 20))

    def test_fares_within_their_interval_are_not_rechecked(self):
        units = self.units()
        state = {scan.unit_key(u): self.stamp(1) for u in units}  # every window is 47+ days out: 4 or 7 day interval
        todo, info = scan.pick(units, [], state, self.NOW, self.TODAY, budget=20)
        self.assertEqual((todo, info["recheck_due"]), ([], 0))

    def test_most_overdue_is_rechecked_first(self):
        units = self.units()
        state = {scan.unit_key(u): self.stamp(10) for u in units}
        state[scan.unit_key(units[-1])] = self.stamp(40)
        todo, _ = scan.pick(units, [], state, self.NOW, self.TODAY, budget=3)
        self.assertEqual(todo[0], units[-1])

    def test_first_searches_go_earliest_departure_first_across_every_route(self):
        units = self.units()
        todo, info = scan.pick(units, [], {}, self.NOW, self.TODAY, budget=6)
        first = scan.windows(self.TODAY)[0][0]
        self.assertTrue(all(u[3] == first for u in todo), "nearest date on every route before any later date")
        self.assertEqual({(u[1], u[2]) for u in todo}, {(o, a) for o in ("LAX", "SNA") for a in ("BZN", "DEN", "SLC")})
        self.assertEqual(info["new_left"], len(units))

    def test_multi_mountain_units_only_get_leftover_budget(self):
        units = self.units(airports=("DEN",), origins=("LAX",))
        extra = [("ow", "LAX", "DEN", date(2027, 1, 9), None), ("ow", "SLC", "LAX", date(2027, 1, 14), None)]
        todo, info = scan.pick(units, extra, {}, self.NOW, self.TODAY, budget=len(units))
        self.assertFalse(set(todo) & set(extra))
        todo, info = scan.pick(units, extra, {}, self.NOW, self.TODAY, budget=len(units) + 1)
        self.assertEqual((todo[-1], info["multi"], info["multi_due"]), (extra[0], 1, 2))
        todo, _ = scan.pick(units, extra, {}, self.NOW, self.TODAY, budget=5, multi_only=True)
        self.assertEqual(todo, extra)

    def test_publish_only_run_searches_nothing(self):
        todo, info = scan.pick(self.units(), [], {}, self.NOW, self.TODAY, budget=0)
        self.assertEqual((todo, info["recheck"], info["new"], info["multi"]), ([], 0, 0, 0))


class ThrottleCooldownTests(unittest.TestCase):
    """A burst of Google status-13 errors pauses the scanner for minutes instead of retrying quickly."""

    ERROR = _page("AF_initDataCallback({key: 'ds:1', hash: '2', data:null, errorHasStatus: true, sideChannel: {}});")
    BOT = _page(None, title="Verifying...")

    def source(self, pages, **kw):
        t = [0.0]
        slept = []

        def sleep(s):
            slept.append(s)
            t[0] += s

        src = google.GoogleFlights(pause=1.5, log=lambda *_: None, clock=lambda: t[0], sleep=sleep, **kw)
        feed = iter(pages)
        orig = google.fetch_flights_html
        google.fetch_flights_html = lambda q, proxy=None: next(feed)
        self.addCleanup(setattr, google, "fetch_flights_html", orig)
        return src, slept, t

    def it(self):
        return google.Itinerary("LAX", "DEN", date(2027, 1, 25), date(2027, 1, 28))

    def test_burst_of_status_13_pauses_once(self):
        src, slept, _ = self.source([self.ERROR] * 3)
        self.assertIsNone(src.search(self.it()))
        self.assertEqual(src.cooldowns, 1)
        self.assertEqual(slept, [5, 10, 300.0, 1.5 * 4])  # two quick backoffs, then the pause; no backoff after it
        self.assertEqual(src.errors, {"google_error": 3})

    def test_pauses_are_capped_per_run(self):
        src, slept, _ = self.source([self.ERROR] * 9)
        for _ in range(3):
            src.search(self.it())
        self.assertEqual(src.cooldowns, 2)
        self.assertEqual(slept.count(300.0), 2)

    def test_spread_out_errors_do_not_pause(self):
        src, slept, t = self.source([self.ERROR] * 3, attempts=1)
        for _ in range(3):
            src.search(self.it())
            t[0] += 200  # next error lands outside the 120 s window
        self.assertEqual((src.cooldowns, slept.count(300.0)), (0, 0))

    def test_bot_check_is_not_retried_and_does_not_pause(self):
        src, slept, _ = self.source([self.BOT])
        self.assertIsNone(src.search(self.it()))
        self.assertEqual((src.cooldowns, slept), (0, [1.5 * 4]))
        self.assertEqual(src.errors, {"bot_check": 1})


if __name__ == "__main__":
    unittest.main()
