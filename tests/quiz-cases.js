// Regression cases for site/quiz-core.js. Runs under Node (tests/quiz.test.js, in CI) and in the browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PFQuizCases = factory;
})(typeof self !== "undefined" ? self : this, function cases(qc, core) {
  "use strict";

  const NOW = Date.parse("2026-12-01T12:00:00Z");
  const FRESH = "2026-12-01T00:00Z", OLD = "2026-11-20T00:00Z";
  const QUIZ = { regions: { rockies: { codes: ["CO", "UT"] }, canada_west: { codes: ["BC"] }, east_midwest: { codes: ["VT"] } },
    marquee: ["vail"], spacing_days: 10, stale_hours: 96 };

  // Build a small dataset. resorts: [id, region, access, airport]; fares: {"AIRPORT": {"dep|ret": price or [price, airline, checked]}}
  function mk(resorts, fares, extra) {
    const D = {
      passes: [
        { id: "ikon_base", name: "Ikon Base Pass", brand: "Ikon", price_adult: 1099, blackouts: [["2027-02-13", "2027-02-14"]] },
        { id: "epic", name: "Epic Pass", brand: "Epic", price_adult: 1169, blackouts: [] },
      ],
      products: [],
      resorts: resorts.map(([id, region, access, ap]) => ({ id, name: id, region, access, airports: [{ code: ap, drive_min: 60 }] })),
      routes: {}, origins: ["LAX"], airlines: { fees: { Delta: 45, Frontier: 75 }, default_fee: 50 },
      tickets: {}, day_snow: {}, quiz: QUIZ,
    };
    for (const [ap, wins] of Object.entries(fares)) {
      D.routes[`LAX-${ap}`] = {};
      for (const [wk, v] of Object.entries(wins)) {
        const [price, airline, checked] = Array.isArray(v) ? v : [v, "Delta", FRESH];
        D.routes[`LAX-${ap}`][wk] = { checked, url: "u", by_airline: { [airline]: [price, 0] } };
      }
    }
    return Object.assign(D, extra || {});
  }
  const opts = { bag: false, exclude: new Set(), origin: "any" };
  const P = (o) => Object.assign({ trips: 1, months: [], shape: "either", priority: "cost", budget: null, pass: "decide", allowOffPass: false, regions: ["any"] }, o);
  const run = (D, prefs, o) => qc.generateSeasonPlans({ data: D, prefs: P(prefs), opts: o || opts, now: NOW });
  const IKON = { ikon_base: "unlimited" };

  // Exhaustive best season (by whole-season cost) for small fixtures.
  function bruteBest(D, prefs, n) {
    const { list } = qc.candidates(D, prefs, opts, NOW);
    let best = Infinity;
    const rec = (start, season) => {
      if (season.length === n) { best = Math.min(best, qc.evaluate(D, prefs, season).total); return; }
      for (let i = start; i < list.length; i++) {
        const c = list[i], last = season[season.length - 1];
        if (season.some((s) => s.resort === c.resort)) continue;
        const sorted = [...season, c].sort((a, b) => (a.depart < b.depart ? -1 : 1));
        let ok = true;
        for (let k = 1; k < sorted.length; k++) if (qc.daysBetween(sorted[k - 1].ret, sorted[k].depart) < 10) ok = false;
        if (ok) rec(i + 1, [...season, c]);
        void last;
      }
    };
    rec(0, []);
    return best;
  }

  return [
    ["Candidates ski the full days between flights (Thu→Sun = Fri, Sat)", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"]], { DEN: { "2027-02-04|2027-02-07": 200 } });
      const { list } = qc.candidates(D, P({ pass: "ikon_base" }), opts, NOW);
      a.equal(list[0].skiDates.join(","), "2027-02-05,2027-02-06");
    }],
    ["Blackout on a flight day doesn't block a trip; on a ski day it does", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"]], { DEN: { "2027-02-11|2027-02-14": 200, "2027-02-15|2027-02-18": 210 } });
      D.passes[0].blackouts = [["2027-02-14", "2027-02-14"]]; // only the Feb 11→14 flight-home day
      a.equal(qc.candidates(D, P({ pass: "ikon_base" }), opts, NOW).list.length, 2);
      D.passes[0].blackouts = [["2027-02-12", "2027-02-12"]]; // a ski day of the Feb 11→14 trip
      const r = qc.candidates(D, P({ pass: "ikon_base" }), opts, NOW);
      a.equal(r.list.length, 1); a.equal(r.lim.blackout, 1);
    }],
    ["Month, weekday and region filters are respected", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"], ["stowe", "VT", IKON, "BTV"]],
        { DEN: { "2027-01-04|2027-01-07": 200, "2027-02-04|2027-02-07": 210 }, BTV: { "2027-02-01|2027-02-04": 220 } });
      a.equal(qc.candidates(D, P({ months: ["02"] }), opts, NOW).list.length, 2);
      a.equal(qc.candidates(D, P({ shape: "weekend" }), opts, NOW).list.length, 1);
      a.equal(qc.candidates(D, P({ shape: "midweek" }), opts, NOW).list.length, 2);
      a.equal(qc.candidates(D, P({ regions: ["east_midwest"] }), opts, NOW).list[0].resort, "stowe");
    }],
    ["Stale fares are left out and counted", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"]], { DEN: { "2027-01-04|2027-01-07": [200, "Delta", OLD], "2027-02-04|2027-02-07": 210 } });
      const r = qc.candidates(D, P({}), opts, NOW);
      a.equal(r.list.length, 1); a.equal(r.lim.stale, 1);
    }],
    ["Airline exclusions and bag setting flow through", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"]], { DEN: { "2027-01-04|2027-01-07": [150, "Frontier", FRESH] } });
      a.equal(qc.candidates(D, P({}), { ...opts, exclude: new Set(["Frontier"]) }, NOW).list.length, 0);
      a.equal(qc.candidates(D, P({}), { ...opts, bag: true }, NOW).list[0].fare.total, 150 + 150);
    }],
    ["Owner pays nothing for the owned pass and is never told to buy it", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"]], { DEN: { "2027-01-04|2027-01-07": 200 } });
      const p = run(D, { pass: "ikon_base" }).plans[0];
      a.equal(p.lift.cost, 0); a.equal(p.lift.owned, "Ikon Base Pass"); a.equal(p.lift.ownedDays, 2); a.equal(p.total, 200);
    }],
    ["Owner: uncovered mountain is priced with tickets (only if allowed)", (a) => {
      const D = mk([["pc", "UT", { epic: "unlimited" }, "SLC"]], { SLC: { "2027-01-04|2027-01-07": 100 } });
      D.tickets.pc = { typical: 200 };
      a.equal(run(D, { pass: "ikon_base" }).plans.length, 0);
      const p = run(D, { pass: "ikon_base", allowOffPass: true }).plans[0];
      a.equal(p.lift.cost, 400); a.equal(p.lift.tickets, 2);
    }],
    ["Cheap flight to an uncovered mountain loses to a pricier covered one on season cost", (a) => {
      const D = mk([["pc", "UT", { epic: "unlimited" }, "SLC"], ["wp", "CO", IKON, "DEN"]],
        { SLC: { "2027-01-04|2027-01-07": 100 }, DEN: { "2027-01-04|2027-01-07": 150 } });
      D.tickets.pc = { typical: 200 }; D.tickets.wp = { typical: 200 };
      a.equal(run(D, { pass: "ikon_base", allowOffPass: true }).plans[0].trips[0].resort, "wp");
    }],
    ["Pass limits are counted across the whole season (shared Alta/Snowbird days)", (a) => {
      const shared = { ikon_base: "3 days combined with Snowbird" };
      const D = mk([["alta", "UT", shared, "SLC"], ["snowbird", "UT", { ikon_base: "3 days combined with Alta" }, "SLC"]],
        { SLC: { "2027-01-04|2027-01-07": 100, "2027-01-25|2027-01-28": 100 } });
      D.tickets.alta = { typical: 150 }; D.tickets.snowbird = { typical: 150 };
      const p = run(D, { pass: "ikon_base", trips: 2 }).plans[0];
      a.equal(p.skiDays, 4); a.equal(p.lift.tickets, 1); a.equal(p.lift.cost, 150);
    }],
    ["Spacing: 9 days between trips is rejected, 10 accepted", (a) => {
      const D9 = mk([["a", "CO", IKON, "DEN"], ["b", "CO", IKON, "EGE"]], { DEN: { "2027-01-04|2027-01-07": 100 }, EGE: { "2027-01-14|2027-01-17": 100 } });
      a.equal(run(D9, { pass: "ikon_base", trips: 2 }).plans[0].trips.length, 1);
      const D10 = mk([["a", "CO", IKON, "DEN"], ["b", "CO", IKON, "EGE"]], { DEN: { "2027-01-04|2027-01-07": 100 }, EGE: { "2027-01-18|2027-01-21": 100 } });
      a.equal(run(D10, { pass: "ikon_base", trips: 2 }).plans[0].trips.length, 2);
    }],
    ["Fewer trips than asked is flagged", (a) => {
      const D = mk([["a", "CO", IKON, "DEN"]], { DEN: { "2027-01-04|2027-01-07": 100 } });
      const r = run(D, { pass: "ikon_base", trips: 2 });
      a.equal(r.plans[0].trips.length, 1); a.equal(r.limitations.fewerTrips, true);
    }],
    ["Greedy counterexample: cheapest first trip blocks the best pair; search finds it", (a) => {
      // A ($100, Jan 11) clashes with D (Jan 4) and B (Jan 18). Greedy A-first ends with A + C = $400; best is D + B = $225.
      const D = mk([["A", "CO", IKON, "A1"], ["B", "CO", IKON, "B1"], ["C", "CO", IKON, "C1"], ["D", "CO", IKON, "D1"]], {
        A1: { "2027-01-11|2027-01-14": 100 }, B1: { "2027-01-18|2027-01-21": 105 },
        C1: { "2027-02-22|2027-02-25": 300 }, D1: { "2027-01-04|2027-01-07": 120 } });
      const p = run(D, { pass: "ikon_base", trips: 2 }).plans[0];
      a.equal(p.total, 225); a.equal(p.trips.map((t) => t.resort).join(","), "D,B");
    }],
    ["Search matches exhaustive search on random small seasons", (a) => {
      let seed = 11;
      const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
      const mondays = ["2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25", "2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22"];
      const addD = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
      for (let t = 0; t < 12; t++) {
        const ids = ["r1", "r2", "r3", "r4", "r5"];
        const access = [IKON, { epic: "unlimited" }, { ikon_base: 2 }, IKON, { epic: 3 }];
        const D = mk(ids.map((id, i) => [id, "CO", access[i], "AP" + i]), {});
        D.products = [{ id: "epic_day", name: "Epic Day Pass", covers: "epic", prices: { 1: 139, 2: 270, 3: 384, 4: 481 }, blackouts: [], verified: true }];
        ids.forEach((id, i) => {
          D.tickets[id] = { typical: 120 + rnd(150) };
          D.routes[`LAX-AP${i}`] = {};
          for (let k = 0; k < 3; k++) { const m = mondays[rnd(mondays.length)]; D.routes[`LAX-AP${i}`][`${m}|${addD(m, 3)}`] = { checked: FRESH, url: "u", by_airline: { Delta: [80 + rnd(300), 0] } }; }
        });
        for (const pass of ["decide", "ikon_base"]) for (const n of [2, 3]) {
          const prefs = P({ pass, trips: n, allowOffPass: true });
          const got = qc.search(D, prefs, qc.candidates(D, prefs, opts, NOW).list, "cost", { spacing: 10, width: 40, pool: 30 });
          const want = bruteBest(D, prefs, n);
          if (want === Infinity) { a.ok(!got || got.season.length < n, "no feasible season expected"); continue; }
          a.equal(got.ev.total, want, `trial ${t} ${pass} ${n} trips`);
        }
      }
    }],
    ["Best snow is weighted by ski days and respects the flight budget", (a) => {
      const D = mk([["deep", "CO", IKON, "DEN"], ["thin", "CO", IKON, "EGE"]],
        { DEN: { "2027-01-04|2027-01-07": 600 }, EGE: { "2027-01-04|2027-01-07": 150 } });
      D.day_snow = { deep: { "01-05": 95, "01-06": 85 }, thin: { "01-05": 20, "01-06": 30 } };
      const free = run(D, { pass: "ikon_base", priority: "snow", budget: 1000 });
      a.equal(free.plans[0].theme, "snow"); a.equal(free.plans[0].trips[0].resort, "deep"); a.equal(free.plans[0].snow, 90);
      const capped = run(D, { pass: "ikon_base", priority: "snow", budget: 400 });
      a.equal(capped.plans[0].trips[0].resort, "thin");
    }],
    ["Without a budget, best snow stays within 1.3x of the lowest-cost plan", (a) => {
      const D = mk([["deep", "CO", IKON, "DEN"], ["thin", "CO", IKON, "EGE"]],
        { DEN: { "2027-01-04|2027-01-07": 600 }, EGE: { "2027-01-04|2027-01-07": 150 } });
      D.day_snow = { deep: { "01-05": 95, "01-06": 85 }, thin: { "01-05": 20, "01-06": 30 } };
      const r = run(D, { pass: "ikon_base", priority: "snow" });
      a.ok(r.plans.every((p) => p.trips[0].resort === "thin"));
    }],
    ["User's priority comes first and is marked best match", (a) => {
      const D = mk([["a", "CO", IKON, "DEN"], ["b", "UT", IKON, "SLC"], ["c", "BC", IKON, "YVR"]],
        { DEN: { "2027-01-04|2027-01-07": 100 }, SLC: { "2027-01-04|2027-01-07": 200 }, YVR: { "2027-01-04|2027-01-07": 300 } });
      D.day_snow = { c: { "01-05": 99, "01-06": 99 } };
      const r = run(D, { pass: "ikon_base", priority: "explore" });
      a.equal(r.plans[0].theme, "explore"); a.equal(r.plans[0].bestMatch, true);
    }],
    ["Near-identical plans are not repeated; fewer plans are explained", (a) => {
      const D = mk([["a", "CO", IKON, "DEN"]], { DEN: { "2027-01-04|2027-01-07": 100 } });
      const r = run(D, { pass: "ikon_base" });
      a.equal(r.plans.length, 1); a.ok(/nearly the same/.test(r.limitations.fewerPlans));
    }],
    ["Same mountains on different dates count as the same plan", (a) => {
      // Cheapest plan and the 'explore' plan both want a (CO) + b (UT); only the dates could differ.
      const D = mk([["a", "CO", IKON, "DEN"], ["b", "UT", IKON, "SLC"]],
        { DEN: { "2027-01-04|2027-01-07": 100, "2027-02-01|2027-02-04": 101 }, SLC: { "2027-01-18|2027-01-21": 100, "2027-02-15|2027-02-18": 101 } });
      D.day_snow = { a: { "02-02": 99, "02-03": 99 }, b: { "02-16": 99, "02-17": 99 } };
      const r = run(D, { pass: "ikon_base", trips: 2 });
      const sets = r.plans.map((p) => p.trips.map((t) => t.resort).sort().join("+"));
      a.equal(new Set(sets).size, sets.length);
    }],
    ["Big-name priority prefers marquee mountains, and falls back gracefully", (a) => {
      const D = mk([["vail", "CO", { epic: "unlimited" }, "EGE"], ["cheap", "CO", { epic: "unlimited" }, "DEN"]],
        { EGE: { "2027-01-04|2027-01-07": 250 }, DEN: { "2027-01-04|2027-01-07": 100 } });
      a.equal(run(D, { pass: "epic", priority: "marquee" }).plans[0].trips[0].resort, "vail");
      const D2 = mk([["cheap", "CO", { epic: "unlimited" }, "DEN"]], { DEN: { "2027-01-04|2027-01-07": 100 } });
      const r = run(D2, { pass: "epic", priority: "marquee" });
      a.equal(r.plans.length, 1); a.equal(r.limitations.noMarquee, true);
    }],
    ["Shopper's verdict matches the planner for the same ski days", (a) => {
      const D = mk([["wp", "CO", IKON, "DEN"], ["cu", "CO", IKON, "EGE"]],
        { DEN: { "2027-01-04|2027-01-07": 100 }, EGE: { "2027-02-01|2027-02-04": 100 } });
      D.tickets.wp = { typical: 250 }; D.tickets.cu = { typical: 250 };
      const p = run(D, { pass: "decide", trips: 2 }).plans[0];
      const days = p.trips.flatMap((t) => t.skiDates.map((d) => ({ r: D.resorts.find((r) => r.id === t.resort), price: 250, date: d })));
      a.equal(p.lift.cost, core.plan(D, days)[0].cost); a.equal(p.dayTickets, 1000);
    }],
    ["Same answers give the same plans", (a) => {
      const D = mk([["a", "CO", IKON, "DEN"], ["b", "UT", IKON, "SLC"]],
        { DEN: { "2027-01-04|2027-01-07": 100, "2027-02-01|2027-02-04": 100 }, SLC: { "2027-01-04|2027-01-07": 100, "2027-02-01|2027-02-04": 100 } });
      a.equal(JSON.stringify(run(D, { pass: "ikon_base", trips: 2 })), JSON.stringify(run(D, { pass: "ikon_base", trips: 2 })));
    }],
  ];
});
