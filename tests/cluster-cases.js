// Regression cases for site/cluster-core.js. Runs under Node (tests/cluster.test.js, in CI)
// and in the browser (same shim as the planner cases).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PFClusterCases = factory;
})(typeof self !== "undefined" ? self : this, function cases(cc, realClusters) {
  "use strict";

  const BASE_BO = [["2026-12-26", "2026-12-30"], ["2027-01-16", "2027-01-17"], ["2027-02-13", "2027-02-14"]];
  const NOW = Date.parse("2027-01-02T12:00:00Z");
  const fresh = "2027-01-02T00:00Z", old = "2026-12-20T00:00Z";
  const D = {
    passes: [
      { id: "ikon", name: "Ikon Pass", brand: "Ikon", blackouts: [] },
      { id: "ikon_base", name: "Ikon Base Pass", brand: "Ikon", blackouts: BASE_BO },
      { id: "epic", name: "Epic Pass", brand: "Epic", blackouts: [] },
    ],
    resorts: [
      { id: "sun-peaks", name: "Sun Peaks", access: { ikon: 7, ikon_base: 5 } },
      { id: "silver-star", name: "SilverStar", access: { ikon: 7, ikon_base: 5 }, verify: ["ikon_base"] },
      { id: "revelstoke", name: "Revelstoke", access: { ikon: 7, ikon_base: 5 } },
      { id: "cypress", name: "Cypress", access: { ikon: 7, ikon_base: 2 } },
      { id: "whistler", name: "Whistler", access: { epic: "unlimited" } },
    ],
    airlines: { fees: { "Air Canada": 45, WestJet: 50, Flair: 85, Alaska: 45 }, default_fee: 50 },
    cluster_routes: { "LAX-YVR": {
      "2027-01-09|2027-01-14": { checked: fresh, url: "rt", by_airline: { "Air Canada": [420, 0], "Alaska, WestJet": [380, 0] } },
      "2027-01-23|2027-01-28": { checked: old, url: "rt", by_airline: { "Air Canada": [300, 0] } } } },
    oneway: {
      "LAX-YVR": { "2027-01-09": { checked: fresh, url: "o1", by_airline: { "Air Canada": [190, 0, "08:00", "11:00"], Flair: [99, 0, "21:00", "23:55"] } },
                   "2027-01-23": { checked: fresh, url: "o1", by_airline: { "Air Canada": [150, 0, "08:00", "11:00"] } } },
      "YLW-LAX": { "2027-01-14": { checked: fresh, url: "o2", by_airline: { WestJet: [140, 1, "07:00", "11:30"] } },
                   "2027-01-28": { checked: fresh, url: "o2", by_airline: { WestJet: [140, 1, "15:00", "19:30"] }, currency: "CAD" } } },
    day_snow: { "sun-peaks": { "01-10": 90, "01-11": 70 }, "silver-star": { "01-13": 20 } },
  };
  const drives = { "YVR>sun-peaks": 316, "sun-peaks>silver-star": 178, "silver-star>YLW": 64, "silver-star>YVR": 375,
    "sun-peaks>revelstoke": 226, "breckenridge>keystone": 39, "DEN>breckenridge": 145 };
  const V5 = { id: "bc-5n", nights: 5,
    stops: [{ resort: "sun-peaks", night_offsets: [0, 1, 2], ski_day_offsets: [1, 2] },
            { resort: "silver-star", night_offsets: [3, 4], ski_day_offsets: [4] }],
    transfer_day_offsets: [0, 3, 5],
    travel_modes: [{ kind: "oj", arrive: "YVR", depart: "YLW", ground_route: ["YVR", "sun-peaks", "silver-star", "YLW"] },
                   { kind: "rt", arrive: "YVR", depart: "YVR", ground_route: ["YVR", "sun-peaks", "silver-star", "YVR"] }] };
  const OJ = V5.travel_modes[0], RT = V5.travel_modes[1];
  const opts = { bag: true, exclude: new Set() };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const list = [
    ["Valid variant has no structural errors", (a) => { a.equal(cc.validate(V5, drives).length, 0); }],
    ["Duplicate and unallocated nights are caught", (a) => {
      const v = clone(V5); v.stops[1].night_offsets = [2, 4];
      const e = cc.validate(v, drives).join("|");
      a.ok(e.includes("night 2 lodged twice"), e); a.ok(e.includes("night 3 has no lodging"), e);
    }],
    ["Ski days on flight days or outside the window are rejected", (a) => {
      const v = clone(V5); v.stops[0].ski_day_offsets = [0, 1]; v.stops[1].ski_day_offsets = [5];
      a.equal(cc.validate(v, drives).filter((x) => x.includes("between the flight days")).length, 2);
    }],
    ["Ski + long drive on the same day is rejected", (a) => {
      const v = clone(V5); v.stops[0].ski_day_offsets = [1, 2, 3]; // then 178 min drive that evening
      a.ok(cc.validate(v, drives).some((x) => x.includes("too much")));
    }],
    ["Day plan marks flights, ski days and drives", (a) => {
      const d = cc.days(V5, "2027-01-09");
      a.equal(d.length, 6); a.equal(d[0].fly, "out"); a.equal(d[5].fly, "back");
      a.equal(d[1].ski, "sun-peaks"); a.equal(d[3].ski, null); a.equal(d[3].drive, true); a.equal(d[4].ski, "silver-star");
    }],
    ["Pass days count ski days, not nights (3+2 nights → 2+1 pass days)", (a) => {
      const s = cc.passStatus(D, V5, "2027-01-09", "ikon");
      a.equal(s.skiDays, 3); a.equal(s.passDays, 3); a.equal(s.stops[0].covered, 2); a.equal(s.stops[1].covered, 1);
    }],
    ["Transfer-only stop uses 0 pass days and does not qualify", (a) => {
      const v = clone(V5); v.stops[1].ski_day_offsets = [];
      const s = cc.passStatus(D, v, "2027-01-09", "ikon");
      a.equal(s.stops[1].status, "none"); a.equal(s.passDays, 2); a.equal(s.qualifies, false);
    }],
    ["Blackout removes a stop's only ski day → fewer than 2 valid resorts", (a) => {
      // depart Feb 9: Sun Peaks Feb 10-11, SilverStar Feb 13 (Base blackout)
      const s = cc.passStatus(D, V5, "2027-02-09", "ikon_base");
      a.equal(s.stops[1].status, "invalid"); a.equal(s.qualifies, false);
      a.equal(cc.passStatus(D, V5, "2027-02-09", "ikon").qualifies, true);
    }],
    ["Blackout on some days → partial", (a) => {
      // depart Jan 14: Sun Peaks Jan 15 + Jan 16 (blackout)
      const s = cc.passStatus(D, V5, "2027-01-14", "ikon_base");
      a.equal(s.stops[0].status, "partial"); a.equal(s.stops[0].uncovered[0], "2027-01-16");
    }],
    ["Pass day cap is counted on ski days", (a) => {
      const v = { nights: 4, stops: [{ resort: "cypress", night_offsets: [0, 1, 2, 3], ski_day_offsets: [1, 2, 3] }], transfer_day_offsets: [] };
      const s = cc.passStatus(D, v, "2027-01-09", "ikon_base");
      a.equal(s.stops[0].covered, 2); a.equal(s.stops[0].status, "partial");
    }],
    ["Unverified access is flagged, not treated as plain valid", (a) => {
      const s = cc.passStatus(D, V5, "2027-01-09", "ikon_base");
      a.equal(s.stops[1].status, "unverified"); a.equal(s.needsVerification, true); a.equal(s.qualifies, true);
    }],
    ["Resort not on the pass is invalid; network-only resorts don't count", (a) => {
      const v = clone(V5); v.stops[1].resort = "whistler";
      const s = cc.passStatus(D, v, "2027-01-09", "ikon");
      a.equal(s.stops[1].status, "invalid"); a.equal(s.qualifies, false);
    }],
    ["Omitted optional stop drops out of pass, snow and driving", (a) => {
      const off = new Set(["silver-star"]);
      a.equal(cc.passStatus(D, V5, "2027-01-09", "ikon", off).qualifies, false);
      a.equal(cc.snow(D, V5, "2027-01-09", off).days, 2);
      const dr = cc.driveFor(V5, OJ, drives, {}, off);
      a.equal(dr.segs.map((s) => s.from + ">" + s.to).join(","), "YVR>sun-peaks,sun-peaks>YLW");
    }],
    ["Round trip drives back to the hub; open-jaw includes both airport legs", (a) => {
      const rt = cc.driveFor(V5, RT, drives, {}), oj = cc.driveFor(V5, OJ, drives, {});
      a.equal(rt.minutes, 316 + 178 + 375); a.equal(oj.minutes, 316 + 178 + 64);
      a.equal(rt.segs[rt.segs.length - 1].to, "YVR"); a.equal(oj.segs[0].from, "YVR"); a.equal(oj.segs[oj.segs.length - 1].to, "YLW");
    }],
    ["Day trips count the drive both ways", (a) => {
      const v = { nights: 3, stops: [{ resort: "breckenridge", night_offsets: [0, 1, 2], ski_day_offsets: [1] },
        { resort: "keystone", night_offsets: [], ski_day_offsets: [2] }], transfer_day_offsets: [] };
      const dr = cc.driveFor(v, { ground_route: ["DEN", "breckenridge", "DEN"] }, drives, {});
      a.equal(dr.minutes, 145 * 2 + 39 * 2); a.equal(dr.complete, true);
    }],
    ["Unknown drive leg marks the route incomplete", (a) => {
      a.equal(cc.driveFor(V5, { ground_route: ["YVR", "sun-peaks", "nowhere"] }, drives, {}).complete, false);
    }],
    ["One-way legs charge the bag once each", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", { bag: true, exclude: new Set(["Flair"]) }, NOW);
      a.equal(q.legs[0].best.total, 190 + 45); a.equal(q.legs[1].best.total, 140 + 50); a.equal(q.total, 235 + 190);
    }],
    ["Cheapest fare is chosen after bag fees", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", opts, NOW);
      a.equal(q.legs[0].best.airline, "Flair"); a.equal(q.legs[0].best.total, 99 + 85);
    }],
    ["Bags off removes bag fees", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", { bag: false, exclude: new Set() }, NOW);
      a.equal(q.total, 99 + 140);
    }],
    ["Mixed-airline round trip is flagged as an estimate", (a) => {
      const q = cc.modeQuote(D, RT, "LAX", "2027-01-09", "2027-01-14", opts, NOW);
      a.equal(q.legs[0].best.airline, "Alaska, WestJet"); a.equal(q.legs[0].best.total, 380 + 100); a.equal(q.bagEstimated, true);
    }],
    ["Airline exclusion removes legs; nothing left → no total", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", { bag: true, exclude: new Set(["WestJet"]) }, NOW);
      a.equal(q.total, null); a.equal(q.reason, "no fare after your airline filters");
      const r = cc.modeQuote(D, RT, "LAX", "2027-01-09", "2027-01-14", { bag: true, exclude: new Set(["WestJet"]) }, NOW);
      a.equal(r.legs[0].best.airline, "Air Canada");
    }],
    ["Missing leg → no invented total, other mode still priced", (a) => {
      const oj = cc.modeQuote(D, OJ, "SNA", "2027-01-09", "2027-01-14", opts, NOW);
      const rt = cc.modeQuote(D, RT, "LAX", "2027-01-09", "2027-01-14", opts, NOW);
      a.equal(oj.total, null); a.equal(oj.reason, "not priced yet");
      const c = cc.compare([oj, rt]); a.equal(c.best.kind, "rt"); a.equal(c.diff, null);
    }],
    ["Stale leg is not compared", (a) => {
      const q = cc.modeQuote(D, RT, "LAX", "2027-01-23", "2027-01-28", opts, NOW);
      a.equal(q.total, null); a.equal(q.legs[0].stale, true);
    }],
    ["Fare in another currency is refused", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-23", "2027-01-28", opts, NOW);
      a.equal(q.total, null); a.equal(q.reason, "fare not in USD");
    }],
    ["Compare picks the cheaper mode and reports the flight-only difference", (a) => {
      const oj = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", opts, NOW); // 184 + 190
      const rt = cc.modeQuote(D, RT, "LAX", "2027-01-09", "2027-01-14", opts, NOW); // 480 (Air Canada 420+90=510)
      const c = cc.compare([rt, oj]); a.equal(c.best.kind, "oj"); a.equal(c.diff, 480 - 374);
    }],
    ["Timing flags a late landing before a long drive and an early flight home", (a) => {
      const q = cc.modeQuote(D, OJ, "LAX", "2027-01-09", "2027-01-14", opts, NOW); // Flair lands 23:55; WestJet 07:00
      const t = cc.timing(q, cc.driveFor(V5, OJ, drives, {}));
      a.equal(t.notes.length, 2); a.equal(t.provisional, false);
      a.equal(cc.timing(cc.modeQuote(D, RT, "LAX", "2027-01-09", "2027-01-14", opts, NOW), {}).provisional, true);
    }],
    ["Snow averages planned ski days only (per-day scale)", (a) => {
      const s = cc.snow(D, V5, "2027-01-09");
      a.equal(s.days, 3); a.equal(s.score, Math.round((90 + 70 + 20) / 3));
      a.equal(s.stops["sun-peaks"].score, 80); a.equal(s.stops["silver-star"].days, 1);
    }],
    ["Snow score does not depend on stop length when conditions are equal", (a) => {
      const d2 = { day_snow: { x: { "01-10": 60, "01-11": 60, "01-12": 60, "01-13": 60 } } };
      const mk = (n) => ({ nights: 5, stops: [{ resort: "x", night_offsets: [0, 1, 2, 3, 4], ski_day_offsets: [1, 2, 3, 4].slice(0, n) }] });
      for (const n of [1, 2, 3, 4]) a.equal(cc.snow(d2, mk(n), "2027-01-09").score, 60);
    }],
  ];

  // Every real cluster in data/clusters.json must be internally consistent and fully drive-mapped.
  if (realClusters) for (const c of realClusters.clusters) for (const v of c.variants) {
    list.push([`data: ${v.id} is consistent`, (a) => {
      const e = cc.validate(v, realClusters.drives); a.equal(e.length, 0, e.join("; "));
      for (const m of v.travel_modes) {
        const dr = cc.driveFor(v, m, realClusters.drives, {});
        a.equal(dr.complete, true, `${v.id} ${m.kind} has an unmapped drive`);
        // the day plan puts one ground-route drive on each transfer day, in order
        a.equal(dr.segs.filter((s) => !s.dayTrip).length, v.transfer_day_offsets.length, `${v.id} ${m.kind}: drives vs transfer days`);
        a.equal(m.ground_route[0], m.arrive); a.equal(m.ground_route[m.ground_route.length - 1], m.depart);
      }
      a.ok(v.stops.filter((s) => s.ski_day_offsets.length).length >= 2, `${v.id} needs 2 skied resorts`);
    }]);
  }
  return list;
});
