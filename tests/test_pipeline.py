"""Tests for the Python data pipeline. Run: python -m unittest discover tests"""

import sys
import unittest
from datetime import date
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


if __name__ == "__main__":
    unittest.main()
