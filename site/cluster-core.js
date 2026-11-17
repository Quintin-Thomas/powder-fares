// Multi-mountain trip math, shared by the website (window.PFCluster) and the tests (Node: require()).
// Pure functions: no DOM, no network. Depends on planner-core.js for pass rules.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./planner-core.js"));
  else root.PFCluster = factory(root.PFCore);
})(typeof self !== "undefined" ? self : this, function (core) {
  "use strict";

  const STALE_HOURS = 96;
  const addDays = (iso, n) => {
    const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // ---- itinerary structure ----

  // Problems with a variant's offsets (empty list = consistent). Used by tests and the build.
  function validate(variant, drives) {
    const errs = [], n = variant.nights, seen = {};
    for (const s of variant.stops) for (const k of s.night_offsets) {
      if (k < 0 || k >= n) errs.push(`${s.resort}: night ${k} outside 0..${n - 1}`);
      if (seen[k]) errs.push(`night ${k} lodged twice (${seen[k]}, ${s.resort})`);
      seen[k] = s.resort;
    }
    for (let k = 0; k < n; k++) if (!seen[k]) errs.push(`night ${k} has no lodging`);
    const skiSeen = {};
    for (const s of variant.stops) for (const k of s.ski_day_offsets) {
      if (k <= 0 || k >= n) errs.push(`${s.resort}: ski day ${k} must be between the flight days`);
      if (skiSeen[k]) errs.push(`day ${k} skied twice`);
      skiSeen[k] = s.resort;
    }
    for (const k of variant.transfer_day_offsets || []) if (k < 0 || k > n) errs.push(`transfer day ${k} outside window`);
    // A ski day that is also a transfer day is only allowed when the drive that evening is short.
    if (drives) for (const t of variant.transfer_day_offsets || []) {
      if (!skiSeen[t]) continue;
      const from = lodgingOn(variant, t - 1), to = lodgingOn(variant, t);
      const m = drives[`${from}>${to}`];
      if (from !== to && !(m <= 150)) errs.push(`day ${t}: ski + ${m || "?"} min drive is too much`);
    }
    return errs;
  }

  const lodgingOn = (variant, night) => (variant.stops.find((s) => s.night_offsets.includes(night)) || {}).resort;

  // Day-by-day plan: [{date, offset, fly, ski, drive, sleep}]
  function days(variant, depart) {
    const out = [];
    for (let k = 0; k <= variant.nights; k++) {
      const ski = variant.stops.find((s) => s.ski_day_offsets.includes(k));
      out.push({ date: addDays(depart, k), offset: k,
        fly: k === 0 ? "out" : k === variant.nights ? "back" : null,
        ski: ski ? ski.resort : null,
        drive: (variant.transfer_day_offsets || []).includes(k),
        sleep: k < variant.nights ? lodgingOn(variant, k) : null });
    }
    return out;
  }

  // Ski dates for one stop. Optional stops the user turned off ski nothing.
  const skiDates = (stop, depart, off) => (off && off.has(stop.resort) ? [] : stop.ski_day_offsets.map((k) => addDays(depart, k)));

  // Total driving for one travel mode: the ground route + out-and-back day trips from lodging.
  function driveFor(variant, mode, drives, cautions, off) {
    const route = mode.ground_route.filter((p) => !(off && off.has(p)));
    const segs = [];
    for (let i = 0; i + 1 < route.length; i++) {
      const key = `${route[i]}>${route[i + 1]}`, rev = `${route[i + 1]}>${route[i]}`;
      segs.push({ from: route[i], to: route[i + 1], min: drives[key] != null ? drives[key] : drives[rev] != null ? drives[rev] : null,
        caution: (cautions || {})[key] || (cautions || {})[rev] || null });
    }
    for (const s of variant.stops) {
      if (s.night_offsets.length || (off && off.has(s.resort))) continue; // day trips only
      for (const k of s.ski_day_offsets) {
        const base = lodgingOn(variant, k - 1);
        const m = drives[`${base}>${s.resort}`] != null ? drives[`${base}>${s.resort}`] : drives[`${s.resort}>${base}`];
        segs.push({ from: base, to: s.resort, min: m == null ? null : 2 * m, dayTrip: true, caution: null });
      }
    }
    const unknown = segs.filter((s) => s.min == null);
    return { segs, minutes: segs.reduce((t, s) => t + (s.min || 0), 0), complete: !unknown.length };
  }

  // ---- pass coverage on the actual ski dates ----

  // status per stop: valid (every ski day covered), partial, invalid, unverified; plus whether the trip qualifies.
  function passStatus(D, variant, depart, passId, off) {
    const pass = D.passes.find((p) => p.id === passId);
    const R = Object.fromEntries(D.resorts.map((r) => [r.id, r]));
    const used = {}; // fresh per trip: assumes no other days used at these resorts this season
    const stops = variant.stops.map((s) => {
      const dates = skiDates(s, depart, off), r = R[s.resort];
      if (!dates.length) return { resort: s.resort, dates, status: "none", covered: 0 };
      const covered = dates.filter((d) => r && pass && core.seasonCover(pass, r, d, used));
      const unverified = r && (r.verify || []).includes(passId);
      let status = !covered.length ? "invalid" : covered.length < dates.length ? "partial" : "valid";
      if (status !== "invalid" && unverified) status = "unverified";
      return { resort: s.resort, dates, covered: covered.length, uncovered: dates.filter((d) => !covered.includes(d)), status };
    });
    const ok = stops.filter((s) => ["valid", "partial", "unverified"].includes(s.status));
    return { stops, qualifies: ok.length >= 2, needsVerification: ok.some((s) => s.status === "unverified"),
      skiDays: stops.reduce((t, s) => t + s.dates.length, 0), passDays: stops.reduce((t, s) => t + s.covered, 0) };
  }

  // ---- airfare + board bags ----

  const fee = (D, airline) => (D.airlines.fees[airline] != null ? D.airlines.fees[airline] : D.airlines.default_fee);

  // Cheapest allowed fare on one leg. oneWay: bag charged once; round trip: twice at the priciest carrier.
  function legBest(D, leg, opts, oneWay) {
    if (!leg || !leg.by_airline) return null;
    if (leg.currency && leg.currency !== "USD") return null;
    let best = null;
    for (const [name, v] of Object.entries(leg.by_airline)) {
      const carriers = name.split(", ");
      if (carriers.some((c) => opts.exclude && opts.exclude.has(c))) continue;
      const bag = opts.bag ? Math.max(...carriers.map((c) => fee(D, c))) * (oneWay ? 1 : 2) : 0;
      const total = v[0] + bag;
      if (!best || total < best.total) best = { airline: name, fare: v[0], bag, total, stops: v[1], dep: v[2] || null, arr: v[3] || null,
        bagEstimated: !oneWay && carriers.length > 1 };
    }
    return best;
  }

  const hoursOld = (iso, now) => (now - Date.parse(iso.endsWith("Z") ? iso : iso + "Z")) / 3.6e6;

  // One travel mode priced for one origin + dates. total is null unless every leg is priced and fresh.
  function modeQuote(D, mode, origin, depart, ret, opts, now) {
    const legs = mode.kind === "rt"
      ? [{ label: `${origin} ⇄ ${mode.arrive}`, data: ((D.cluster_routes || {})[`${origin}-${mode.arrive}`] || {})[`${depart}|${ret}`], oneWay: false }]
      : [{ label: `${origin} → ${mode.arrive}`, data: ((D.oneway || {})[`${origin}-${mode.arrive}`] || {})[depart], oneWay: true },
         { label: `${mode.depart} → ${origin}`, data: ((D.oneway || {})[`${mode.depart}-${origin}`] || {})[ret], oneWay: true }];
    let total = 0, reason = null;
    for (const l of legs) {
      l.best = legBest(D, l.data, opts, l.oneWay);
      l.age = l.data && l.data.checked ? hoursOld(l.data.checked, now) : null;
      l.stale = l.age != null && l.age > STALE_HOURS;
      l.url = l.data ? l.data.url : null;
      if (!l.data) reason = reason || "not priced yet";
      else if (l.data.currency && l.data.currency !== "USD") reason = reason || "fare not in USD";
      else if (!l.best) reason = reason || "no fare after your airline filters";
      else if (l.stale) reason = reason || "fare too old to compare";
      if (l.best) total += l.best.total;
    }
    return { kind: mode.kind, mode, legs, total: reason ? null : total, reason,
      bagEstimated: legs.some((l) => l.best && l.best.bagEstimated) };
  }

  // Timing checks from flight times (only one-way legs carry times). Returns notes; empty = fine or unknown.
  function timing(q, drive) {
    const notes = [];
    if (q.kind !== "oj") return { provisional: true, notes };
    const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const first = drive.segs[0], last = drive.segs.filter((s) => !s.dayTrip).slice(-1)[0];
    const out = q.legs[0].best, back = q.legs[1].best;
    let provisional = false;
    if (out && out.arr && first && first.min != null) {
      const at = toMin(out.arr) + 60 + first.min; // 60 min to get bags and the car
      if (at > 23 * 60) notes.push(`Lands ${out.arr}; with a ${Math.round(first.min / 60 * 10) / 10} h drive you'd arrive after 11 pm`);
    } else provisional = true;
    if (back && back.dep && last && last.min != null) {
      const leave = toMin(back.dep) - 120 - last.min; // be at the airport 2 h early
      if (leave < 6 * 60) notes.push(`Flight home leaves ${back.dep}; you'd need to leave before 6 am`);
    } else provisional = true;
    return { provisional, notes };
  }

  // Cheapest priced mode and the flight-only difference to the other one (only when both are priced).
  function compare(quotes) {
    const priced = quotes.filter((q) => q.total != null).sort((a, b) => a.total - b.total);
    return { best: priced[0] || null, diff: priced.length > 1 ? priced[1].total - priced[0].total : null, other: priced[1] || null };
  }

  // ---- snow: per ski day, so 1- and 4-day stops are on the same scale ----

  // daySnow[resort][MM-DD] = percentile 0-100 of that day's historical conditions (built by build.py).
  function snow(D, variant, depart, off) {
    const per = [], byStop = {};
    for (const s of variant.stops) for (const d of skiDates(s, depart, off)) {
      const v = ((D.day_snow || {})[s.resort] || {})[d.slice(5)];
      if (v == null) continue;
      per.push(v); (byStop[s.resort] = byStop[s.resort] || []).push(v);
    }
    const mean = (a) => Math.round(a.reduce((t, x) => t + x, 0) / a.length);
    const stops = Object.fromEntries(Object.entries(byStop).map(([k, a]) => [k, { score: mean(a), days: a.length }]));
    return { score: per.length ? mean(per) : null, days: per.length, stops };
  }

  const gradeOf = (score) => score == null ? null : score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F";

  return { STALE_HOURS, addDays, validate, days, lodgingOn, driveFor, passStatus, legBest, modeQuote, timing, compare, snow, gradeOf };
});
