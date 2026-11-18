// "Help me plan" engine: turns 5 quiz answers into up to 3 different season plans.
// Pure functions (no DOM, no storage); shared by the site (window.PFQuiz) and the tests (Node).
// Depends on planner-core.js for ski dates and lift-cost math.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./planner-core.js"));
  else root.PFQuiz = factory(root.PFCore);
})(typeof self !== "undefined" ? self : this, function (core) {
  "use strict";

  const DAY = 864e5;
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
  const THEMES = {
    cost: { label: "Lowest total cost", reason: "Cheapest flights + lift access for the whole season" },
    snow: { label: "Best snow", reason: "Best historical snow on your ski days, within budget" },
    explore: { label: "Explore different regions", reason: "Spreads your trips across different states and provinces" },
    marquee: { label: "Big-name mountains", reason: "Well-known destination mountains that fit your dates and pass" },
  };

  // Cheapest allowed round-trip fare for one scanned window (same rules as the Find trips cards).
  function quote(D, win, opts) {
    let best = null;
    for (const [name, v] of Object.entries(win.by_airline || {})) {
      const al = name.split(", ");
      if (opts.exclude && al.some((a) => opts.exclude.has(a))) continue;
      const bag = opts.bag ? Math.max(...al.map((a) => D.airlines.fees[a] ?? D.airlines.default_fee)) * 2 : 0;
      if (!best || v[0] + bag < best.total) best = { name, fare: v[0], bag, stops: v[1], total: v[0] + bag };
    }
    return best;
  }

  const ticket = (D, id) => (D.tickets[id] && D.tickets[id].typical) || 150;

  function groupOf(D, r) {
    for (const [k, g] of Object.entries((D.quiz || {}).regions || {})) if (g.codes.includes(r.region)) return k;
    return null;
  }

  // ---- candidates: one per (resort, date window), cheapest origin/airport ----
  function candidates(D, prefs, opts, now) {
    const staleH = (D.quiz && D.quiz.stale_hours) || 96;
    const owned = prefs.pass !== "decide" ? D.passes.find((p) => p.id === prefs.pass) : null;
    const anyRegion = !prefs.regions || !prefs.regions.length || prefs.regions.includes("any");
    const origins = D.origins.filter((o) => !opts.origin || opts.origin === "any" || o === opts.origin);
    const out = {}, lim = { stale: 0, blackout: 0 };
    for (const r of D.resorts) {
      if (!anyRegion && !prefs.regions.includes(groupOf(D, r))) continue;
      const onPass = owned ? r.access[owned.id] != null : Object.keys(r.access).length > 0;
      if (!onPass && !(owned && prefs.allowOffPass)) continue;
      for (const o of origins) for (const ap of r.airports) {
        for (const [wk, win] of Object.entries(D.routes[`${o}-${ap.code}`] || {})) {
          const [dep, ret] = wk.split("|");
          if (prefs.months && prefs.months.length && !prefs.months.includes(dep.slice(5, 7))) continue;
          const wd = new Date(dep + "T12:00:00Z").getUTCDay();
          if (prefs.shape === "weekend" && wd !== 4) continue;
          if (prefs.shape === "midweek" && wd !== 1) continue;
          const q = quote(D, win, opts);
          if (!q) continue;
          const age = win.checked ? (now - Date.parse(/Z$/.test(win.checked) ? win.checked : win.checked + "Z")) / 36e5 : Infinity;
          if (age > staleH) { lim.stale++; continue; }
          const skiDates = core.skiDates(wk);
          // An owned pass must actually cover this resort on these ski dates (blackouts are checked on ski days, not flight days).
          if (owned && onPass && !prefs.allowOffPass && skiDates.some((d) => !core.seasonCover(owned, r, d, {}))) { lim.blackout++; continue; }
          const id = `${r.id}|${wk}`;
          if (out[id] && out[id].fare.total <= q.total) continue;
          const per = skiDates.map((d) => ((D.day_snow || {})[r.id] || {})[d.slice(5)]).filter((v) => v != null);
          out[id] = { id, r, resort: r.id, group: groupOf(D, r), state: r.region, wk, depart: dep, ret, origin: o, airport: ap.code,
            fare: q, checked: win.checked, url: win.url, skiDates, snowDays: per,
            marquee: ((D.quiz || {}).marquee || []).includes(r.id) };
        }
      }
    }
    const list = Object.values(out).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { list, lim };
  }

  // ---- whole-season evaluation: flights + lift access over every ski day of the season ----
  function evaluate(D, prefs, season) {
    const skiDays = [];
    for (const c of season) for (const date of c.skiDates) skiDays.push({ r: c.r, price: ticket(D, c.resort), date });
    const scored = prefs.pass !== "decide" ? core.planOwned(D, skiDays, prefs.pass) : core.plan(D, skiDays);
    const best = scored[0];
    const base = skiDays.reduce((t, d) => t + d.price, 0); // day tickets for the same days
    const flights = season.reduce((t, c) => t + c.fare.total, 0);
    const snowAll = season.flatMap((c) => c.snowDays);
    return { flights, lift: best, scored, base, total: flights + (best ? best.cost : base),
      snow: snowAll.length ? snowAll.reduce((t, x) => t + x, 0) / snowAll.length : null, snowDays: snowAll.length,
      skiDays: skiDays.length, regions: new Set(season.map((c) => c.state)).size, marquee: season.filter((c) => c.marquee).length };
  }

  // Lower is better. Themes rank complete seasons, not single trips.
  function objective(theme, ev) {
    const snow = ev.snow == null ? 40 : ev.snow;
    if (theme === "cost") return ev.total - snow / 100;
    if (theme === "snow") return -snow * 1000 + ev.total / 100;
    if (theme === "explore") return ev.total - 300 * (ev.regions - 1);
    if (theme === "marquee") return ev.total - 400 * ev.marquee - snow;
    return ev.total;
  }

  // Single-trip proxy used only to choose the search pool (the real ranking uses whole seasons).
  function proxy(theme, c, D) {
    const lift = ticket(D, c.resort) * c.skiDates.length * 0.5;
    const snow = c.snowDays.length ? c.snowDays.reduce((t, x) => t + x, 0) / c.snowDays.length : 40;
    if (theme === "snow") return -snow * 10 + (c.fare.total + lift) / 50;
    if (theme === "marquee") return c.fare.total + lift - (c.marquee ? 400 : 0);
    return c.fare.total + lift - snow / 10;
  }

  const tie = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sig = (season) => season.map((c) => c.id).join("+");

  // Bounded beam search over complete seasons. Trips are added in date order; spacing is
  // next departure minus previous return >= spacing days; each mountain once.
  function search(D, prefs, cands, theme, cfg) {
    const spacing = cfg.spacing, width = cfg.width || 40, K = cfg.pool || 30;
    // Pool: the best K overall plus the best few in every week, so a long season can still be filled
    // (spacing rules out most pairs inside one hot week). At most 3 windows per mountain.
    const ranked = cands.slice().sort((a, b) => proxy(theme, a, D) - proxy(theme, b, D) || tie(a.id, b.id));
    const perResort = {}, perWeek = {}, picked = new Set();
    const week = (c) => Math.floor(Date.parse(c.depart + "T12:00:00Z") / (7 * DAY));
    const take = (c) => { picked.add(c); perResort[c.resort] = (perResort[c.resort] || 0) + 1; perWeek[week(c)] = (perWeek[week(c)] || 0) + 1; };
    for (const c of ranked) if (picked.size < K && (perResort[c.resort] || 0) < 3) take(c);
    for (const c of ranked) if (!picked.has(c) && (perWeek[week(c)] || 0) < 3 && (perResort[c.resort] || 0) < 3) take(c);
    const pool = [...picked].sort((a, b) => tie(a.depart, b.depart) || tie(a.id, b.id));
    const ok = (season) => !cfg.flightCap || season.reduce((t, c) => t + c.fare.total, 0) <= cfg.flightCap;
    let beam = [{ season: [], score: 0 }], best = null;
    for (let step = 0; step < prefs.trips; step++) {
      const next = new Map();
      for (const st of beam) {
        const last = st.season[st.season.length - 1];
        for (const c of pool) {
          if (last && (c.depart <= last.depart || daysBetween(last.ret, c.depart) < spacing)) continue;
          if (st.season.some((s) => s.resort === c.resort)) continue;
          const season = [...st.season, c];
          if (!ok(season)) continue;
          const key = sig(season);
          if (next.has(key)) continue;
          const ev = evaluate(D, prefs, season);
          if (cfg.totalCap && ev.total > cfg.totalCap) continue;
          next.set(key, { season, ev, score: objective(theme, ev) });
        }
      }
      if (!next.size) break;
      beam = [...next.values()].sort((a, b) => a.score - b.score || tie(sig(a.season), sig(b.season))).slice(0, width);
      best = beam[0];
    }
    return best;
  }

  // Share of trips (same mountain + same dates) two plans have in common.
  const overlap = (a, b) => {
    const ids = new Set(a.season.map((c) => c.id));
    return b.season.filter((c) => ids.has(c.id)).length / Math.max(a.season.length, b.season.length);
  };

  function describeLift(D, prefs, ev) {
    const l = ev.lift;
    if (!l) return null;
    const owned = prefs.pass !== "decide" ? D.passes.find((p) => p.id === prefs.pass) : null;
    const coveredBy = (label) => l.parts.filter((p) => p.label === label).reduce((t, p) => t + Object.values(p.days).reduce((x, y) => x + y, 0), 0);
    return { label: l.label, cost: l.cost, tickets: l.tickets, parts: l.parts, unverified: !!l.unverified,
      owned: owned ? owned.name : null, ownedDays: owned ? coveredBy(owned.name) : null,
      savingsVsTickets: ev.base - l.cost };
  }

  function generateSeasonPlans({ data, prefs, opts, now }) {
    // Day-ticket prices the user edited in the planner apply here too, so totals reconcile.
    const ov = (opts && opts.tickets) || {};
    const D = Object.keys(ov).length ? { ...data, tickets: { ...data.tickets, ...Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, { ...(data.tickets[k] || {}), typical: v }])) } } : data;
    const cfg = { spacing: (D.quiz && D.quiz.spacing_days) || 10, width: 40, pool: 30 };
    const { list, lim } = candidates(D, prefs, opts, now);
    const order = [prefs.priority, ...["cost", "snow", "explore"].filter((t) => t !== prefs.priority)];
    const found = {};
    // Cost first: the snow theme is held to a budget relative to it when the user gave none.
    found.cost = search(D, prefs, list, "cost", { ...cfg, flightCap: prefs.budget || null });
    const capTotal = !prefs.budget && found.cost ? found.cost.ev.total * 1.3 : null;
    for (const t of order) if (!found[t]) found[t] = search(D, prefs, list, t, { ...cfg, flightCap: prefs.budget || null, totalCap: t === "snow" ? capTotal : null });

    const plans = [], dropped = [];
    for (const t of order) {
      const p = found[t];
      if (!p) continue;
      if (plans.some((q) => overlap(q, p) > 0.5)) { dropped.push(t); continue; }
      plans.push({ theme: t, ...p });
      if (plans.length === 3) break;
    }
    const noMarquee = prefs.priority === "marquee" && found.marquee && found.marquee.ev.marquee === 0;
    return {
      plans: plans.map((p, i) => ({
        theme: p.theme, label: THEMES[p.theme].label,
        reason: p.theme === "marquee" && !p.ev.marquee ? "No big-name mountains fit your dates and pass, so this is the best value instead" : THEMES[p.theme].reason,
        bestMatch: i === 0 && p.theme === prefs.priority,
        trips: p.season.map((c) => ({ resort: c.resort, name: c.r.name, region: c.state, win: c.wk, depart: c.depart, ret: c.ret,
          origin: c.origin, airport: c.airport, fare: c.fare, checked: c.checked, url: c.url, skiDates: c.skiDates,
          snow: c.snowDays.length ? Math.round(c.snowDays.reduce((t, x) => t + x, 0) / c.snowDays.length) : null, marquee: c.marquee })),
        flights: p.ev.flights, lift: describeLift(D, prefs, p.ev), dayTickets: p.ev.base, total: p.ev.total,
        snow: p.ev.snow == null ? null : Math.round(p.ev.snow), skiDays: p.ev.skiDays,
        provisional: !!(p.ev.lift && p.ev.lift.unverified),
      })),
      limitations: {
        candidates: list.length, stale: lim.stale, blackout: lim.blackout,
        fewerTrips: plans.some((p) => p.season.length < prefs.trips),
        fewerPlans: plans.length < 3 ? (dropped.length ? "The other themes came out nearly the same as these, so they're not repeated." : "Not enough priced trips for more options yet.") : null,
        approximate: prefs.trips >= 4, noMarquee,
      },
    };
  }

  return { THEMES, quote, candidates, evaluate, objective, search, generateSeasonPlans, daysBetween };
});
