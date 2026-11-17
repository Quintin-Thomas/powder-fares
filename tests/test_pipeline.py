"""Tests for the Python data pipeline. Run: python -m unittest discover tests"""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build  # noqa: E402
import scan  # noqa: E402
import snow  # noqa: E402


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
