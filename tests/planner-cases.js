// Regression cases for site/planner-core.js. Runs under Node (tests/planner.test.js, in CI)
// and in the browser (loaded with a tiny shim) so they can be checked without Node installed.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PFPlannerCases = factory;
})(typeof self !== "undefined" ? self : this, function cases(core) {
  "use strict";

  // ---- fixtures: small, hand-checkable versions of the real data shapes ----
  const BASE_BO = [["2026-12-26", "2026-12-30"], ["2027-01-16", "2027-01-17"], ["2027-02-13", "2027-02-14"]];
  const EPIC_BO = [["2026-11-27", "2026-11-28"], ["2026-12-26", "2026-12-31"], ["2027-01-16", "2027-01-16"], ["2027-02-13", "2027-02-14"]];
  const R = {
    wp: { id: "winter-park", name: "Winter Park", access: { ikon: "unlimited", ikon_base: "unlimited" } },
    bird: { id: "snowbird", name: "Snowbird", access: { ikon: "7 days combined with Alta", ikon_base: 5 } },
    alta: { id: "alta", name: "Alta", access: { ikon: "7 days combined with Snowbird" } },
    jh: { id: "jackson-hole", name: "Jackson Hole", access: { ikon: 7 } },
    schw: { id: "schweitzer", name: "Schweitzer", access: { ikon: "unlimited", ikon_base: 5 }, verify: ["ikon_base"] },
    pc: { id: "park-city", name: "Park City", access: { epic: "unlimited", epic_local: "holiday blackouts" } },
    breck: { id: "breckenridge", name: "Breckenridge", access: { epic: "unlimited", epic_local: "unlimited" } },
    tell: { id: "telluride", name: "Telluride", access: { epic: 7 } },
  };
  const D = {
    passes: [
      { id: "ikon", name: "Ikon Pass", brand: "Ikon", price_adult: 1529, blackouts: [] },
      { id: "ikon_base", name: "Ikon Base Pass", brand: "Ikon", price_adult: 1099, blackouts: BASE_BO },
      { id: "epic", name: "Epic Pass", brand: "Epic", price_adult: 1169, blackouts: [] },
      { id: "epic_local", name: "Epic Local Pass", brand: "Epic", price_adult: 869, blackouts: EPIC_BO },
    ],
    products: [
      { id: "ikon_session", name: "Ikon Session Pass", covers: "ikon", prices: { 2: 369, 3: 509, 4: 639 },
        eligible: { from_pass: "ikon_base" }, blackouts: BASE_BO, verified: false },
      { id: "epic_day", name: "Epic Day Pass (All Resorts)", covers: "epic", prices: { 1: 139, 2: 270, 3: 384, 4: 481 },
        blackouts: EPIC_BO, partner_min_days: 4, partner_resorts: ["telluride"], verified: true },
    ],
  };
  const day = (r, price, date) => ({ r, price, date });
  const opt = (label) => core.options(D).find((o) => o.label === label);
  const priceOf = (label, days) => { const o = opt(label); return core.price(days, o.ikon, o.epic); };

  // Exhaustive search: try every way of paying for every day, respecting all rules.
  function bruteForce(days, o) {
    const sides = [o.ikon, o.epic];
    let fixed = 0;
    for (const p of sides) fixed += p.kind === "season" ? p.pass.price_adult : p.kind === "pool" ? p.cost : 0;
    let best = Infinity;
    const choices = ["ticket", 0, 1]; // ticket, or side 0 (Ikon) / side 1 (Epic)
    const n = days.length;
    const total = Math.pow(3, n);
    for (let code = 0; code < total; code++) {
      let c = code, cost = fixed, ok = true;
      const used = {}, pool = [sides[0].days || 0, sides[1].days || 0];
      for (let i = 0; i < n && ok; i++) {
        const ch = choices[c % 3]; c = Math.floor(c / 3);
        const d = days[i];
        if (ch === "ticket") { cost += d.price; continue; }
        const p = sides[ch];
        if (p.kind === "season") ok = core.seasonCover(p.pass, d.r, d.date, used);
        else if (p.kind === "pool") { ok = pool[ch] > 0 && core.poolCovers(p, d.r, d.date); pool[ch]--; }
        else ok = false;
      }
      if (ok) best = Math.min(best, cost);
    }
    return best;
  }

  return [
    ["Day tickets only adds up every day", (a) => {
      const r = priceOf("Day tickets only", [day(R.wp, 180), day(R.pc, 275)]);
      a.equal(r.cost, 455); a.equal(r.tickets, 2);
    }],
    ["Ikon Base covers unlimited resort, not Epic resort", (a) => {
      const r = priceOf("Ikon Base Pass", [day(R.wp, 180, "2027-02-02"), day(R.pc, 275, "2027-02-02")]);
      a.equal(r.cost, 1099 + 275); a.equal(r.tickets, 1);
    }],
    ["Ikon Base blackout day must be bought as a ticket", (a) => {
      const r = priceOf("Ikon Base Pass", [day(R.wp, 180, "2027-02-13"), day(R.wp, 180, "2027-02-15")]);
      a.equal(r.tickets, 1); a.equal(r.cost, 1099 + 180);
    }],
    ["Ikon Base day cap (5 at Snowbird) is enforced", (a) => {
      const days = Array.from({ length: 7 }, (_, i) => day(R.bird, 170, `2027-03-0${i + 1}`));
      const r = priceOf("Ikon Base Pass", days);
      a.equal(r.tickets, 2);
    }],
    ["Alta + Snowbird share one 7-day Ikon allowance", (a) => {
      const days = [...Array.from({ length: 5 }, (_, i) => day(R.alta, 150, `2027-03-0${i + 1}`)),
                    ...Array.from({ length: 4 }, (_, i) => day(R.bird, 170, `2027-03-1${i}`))];
      a.equal(priceOf("Ikon Pass", days).tickets, 2);
    }],
    ["Jackson Hole is not on Ikon Base", (a) => {
      a.equal(priceOf("Ikon Base Pass", [day(R.jh, 255, "2027-02-02")]).tickets, 1);
    }],
    ["Ikon Session can't be used where Ikon Base doesn't go (Jackson Hole)", (a) => {
      const r = priceOf("Ikon Session Pass 2-day", [day(R.jh, 255, "2027-02-02"), day(R.jh, 255, "2027-02-03")]);
      a.equal(r.tickets, 2);
    }],
    ["Ikon Session respects blackout dates", (a) => {
      const r = priceOf("Ikon Session Pass 2-day", [day(R.wp, 180, "2027-01-16"), day(R.wp, 180, "2027-01-18")]);
      a.equal(r.tickets, 1);
    }],
    ["Using the Ikon Session Pass is flagged unverified", (a) => {
      a.ok(priceOf("Ikon Session Pass 2-day", [day(R.wp, 180, "2027-02-02")]).unverified);
    }],
    ["Unverified day limit is flagged; verified one is not", (a) => {
      a.ok(priceOf("Ikon Base Pass", [day(R.schw, 120, "2027-02-02")]).unverified);
      a.ok(!priceOf("Ikon Base Pass", [day(R.wp, 180, "2027-02-02")]).unverified);
    }],
    ["Epic Day 1-3 day can't be used at Telluride; 4-day can", (a) => {
      const d = [day(R.tell, 225, "2027-02-02")];
      a.equal(priceOf("Epic Day Pass 3-day", d).tickets, 1);
      a.equal(priceOf("Epic Day Pass 4-day", d).tickets, 0);
    }],
    ["Epic Local holiday blackout applies only at holiday-restricted resorts", (a) => {
      a.equal(priceOf("Epic Local Pass", [day(R.pc, 275, "2027-01-16")]).tickets, 1);
      a.equal(priceOf("Epic Local Pass", [day(R.breck, 250, "2027-01-16")]).tickets, 0);
    }],
    ["Multi-day pass goes to the most expensive days first", (a) => {
      const r = priceOf("Epic Day Pass 1-day", [day(R.breck, 200, "2027-02-02"), day(R.pc, 275, "2027-02-03")]);
      a.equal(r.cost, 139 + 200);
    }],
    ["Planner matches exhaustive search on mixed fixtures", (a) => {
      const pool = [R.wp, R.bird, R.alta, R.jh, R.pc, R.breck, R.tell];
      const dates = ["2027-01-16", "2027-02-02", "2027-02-13", "2027-02-20", "2027-03-05"];
      let seed = 7;
      const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
      for (let t = 0; t < 40; t++) {
        const n = 3 + rnd(5); // 3-7 ski days
        const days = Array.from({ length: n }, () => day(pool[rnd(pool.length)], 80 + rnd(250), dates[rnd(dates.length)]));
        for (const o of core.options(D)) {
          const got = core.price(days, o.ikon, o.epic).cost;
          const want = bruteForce(days, o);
          if (got !== want) a.equal(got, want, `${o.label} on trial ${t}`);
        }
      }
      a.ok(true);
    }],
    ["plan() returns cheapest option first", (a) => {
      const scored = core.plan(D, [day(R.pc, 275, "2027-01-28"), day(R.pc, 275, "2027-01-29"), day(R.pc, 275, "2027-01-30")]);
      a.equal(scored[0].label, "Epic Day Pass 3-day");
      for (let i = 1; i < scored.length; i++) a.ok(scored[i - 1].cost <= scored[i].cost);
    }],
    ["Ski dates default to the full days between flights (Thu→Sun = Fri, Sat)", (a) => {
      a.equal(core.skiDates("2027-02-04|2027-02-07").join(","), "2027-02-05,2027-02-06");
      a.equal(core.skiDates("2027-02-04|2027-02-07", { days: 3 }).length, 2); // old saved trips asked for 3: capped
    }],
    ["Arrival day and flight-home day are opt-in", (a) => {
      a.equal(core.skiDates("2027-02-04|2027-02-07", { first: "0" })[0], "2027-02-04");
      a.equal(core.skiDates("2027-02-04|2027-02-07", { last: "1" }).at(-1), "2027-02-07");
      a.equal(core.skiDates("2027-02-04|2027-02-07", { first: "0", last: "1", days: 9 }).length, 4);
    }],
    ["Ski-day count limits the dates", (a) => {
      a.equal(core.skiDates("2027-02-01|2027-02-08", { days: 3 }).join(","), "2027-02-02,2027-02-03,2027-02-04");
    }],
    ["Owned pass costs nothing extra; uncovered days are still paid", (a) => {
      const days = [day(R.wp, 180, "2027-02-02"), day(R.pc, 275, "2027-02-03")];
      const best = core.planOwned(D, days, "ikon_base")[0];
      a.equal(best.cost, 139); // Winter Park on the owned pass ($0); Park City on an Epic Day 1-day ($139 < $275 ticket)
      const ticketsOnly = core.planOwned(D, days, "ikon_base").find((o) => o.epic.kind === "none");
      a.equal(ticketsOnly.cost, 275); // owned pass is never charged
    }],
    ["Owner of one network may still use the other network's day product", (a) => {
      const days = [day(R.pc, 275, "2027-02-02"), day(R.pc, 275, "2027-02-03")];
      const best = core.planOwned(D, days, "ikon_base")[0];
      a.equal(best.cost, 270); // Epic Day 2-day beats two $275 tickets
      a.ok(core.planOwned(D, days, "ikon_base").every((o) => o.ikon.pass && o.ikon.pass.id === "ikon_base"));
    }],
  ];
});
