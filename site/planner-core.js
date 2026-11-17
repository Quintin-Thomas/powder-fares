// Pass-planner math, shared by the website (window.PFCore) and the tests (Node: require()).
// Pure functions: no DOM, no network.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PFCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Resorts that share one day allowance on a pass.
  const GROUPS = { alta: "alta-snowbird", snowbird: "alta-snowbird", killington: "killington-pico", pico: "killington-pico" };
  const inBlackout = (blackouts, date) => !!date && (blackouts || []).some(([a, b]) => a <= date && date <= b);

  // Can this season pass cover this resort on this date, given days already used? Mutates `used` on success.
  function seasonCover(pass, r, date, used) {
    const a = r.access[pass.id];
    if (a == null) return false;
    const s = String(a);
    const blackoutApplies = pass.blackouts.length && (pass.id !== "epic_local" || s.includes("holiday"));
    if (blackoutApplies && inBlackout(pass.blackouts, date)) return false;
    const cap = a === "unlimited" || s.startsWith("unlimited") || s === "holiday blackouts" ? Infinity : parseInt(s, 10) || Infinity;
    const group = GROUPS[r.id] ? `${pass.id}:${GROUPS[r.id]}`
      : s.includes("combined") ? `${pass.id}:${s.replace(/ with .*/, "")}` : `${pass.id}:${r.id}`;
    if ((used[group] || 0) >= cap) return false;
    used[group] = (used[group] || 0) + 1;
    return true;
  }

  // Can a multi-day product (Ikon Session / Epic Day) be used at this resort on this date?
  function poolCovers(opt, r, date) {
    const pr = opt.product;
    const network = pr.eligible && pr.eligible.from_pass ? pr.eligible.from_pass : pr.covers;
    if (r.access[network] == null) return false;
    if ((pr.partner_resorts || []).includes(r.id) && opt.days < (pr.partner_min_days || 0)) return false;
    if (inBlackout(pr.blackouts, date)) return false;
    return true;
  }

  const isUnverified = (pass, r) => (r.verify || []).includes(pass.id);

  // Price one combination. skiDays: [{r, price, date}]; ikon/epic: {kind:'none'|'season'|'pool', ...}.
  // Days are assigned highest ticket price first. Within one product every day costs the same,
  // and the Ikon and Epic networks don't overlap, so spending allowance on the priciest eligible
  // days first gives the minimum (checked against brute force in tests/planner.test.js).
  function price(skiDays, ikon, epic) {
    let cost = 0, tickets = 0, unverified = false;
    const used = {}, pool = { ikon: ikon.kind === "pool" ? ikon.days : 0, epic: epic.kind === "pool" ? epic.days : 0 };
    const parts = [];
    const part = (label, c) => { let x = parts.find((p) => p.label === label); if (!x) parts.push(x = { label, cost: c, days: {} }); return x; };
    for (const p of [ikon, epic]) {
      if (p.kind === "season") { cost += p.pass.price_adult; part(p.pass.name, p.pass.price_adult); }
      if (p.kind === "pool") { cost += p.cost; part(p.label, p.cost); }
    }
    const days = [...skiDays].sort((a, b) => b.price - a.price);
    for (const d of days) {
      let by = null;
      for (const p of [ikon, epic]) {
        if (!by && p.kind === "season" && seasonCover(p.pass, d.r, d.date, used)) {
          by = p.pass.name;
          if (isUnverified(p.pass, d.r)) unverified = true;
        }
      }
      for (const [brand, p] of [["ikon", ikon], ["epic", epic]]) {
        if (!by && p.kind === "pool" && pool[brand] > 0 && poolCovers(p, d.r, d.date)) {
          pool[brand]--; by = p.label;
          if (p.product.verified === false) unverified = true;
        }
      }
      if (!by) { cost += d.price; tickets += 1; by = "Day tickets"; part(by, 0).cost += d.price; }
      const x = part(by, 0); x.days[d.r.name] = (x.days[d.r.name] || 0) + 1;
    }
    return { cost, tickets, unverified, parts: parts.filter((p) => Object.keys(p.days).length || p.cost) };
  }

  // Every Ikon option × every Epic option (including "none").
  function options(D) {
    const side = (brand) => {
      const out = [{ kind: "none", label: "" }];
      for (const p of D.passes.filter((p) => p.brand.toLowerCase() === brand)) out.push({ kind: "season", pass: p, label: p.name });
      for (const pr of (D.products || []).filter((p) => p.covers === brand))
        for (const [n, c] of Object.entries(pr.prices)) out.push({ kind: "pool", product: pr, days: +n, cost: c, label: `${pr.name.replace(" (All Resorts)", "")} ${n}-day` });
      return out;
    };
    const res = [];
    for (const i of side("ikon")) for (const e of side("epic"))
      res.push({ ikon: i, epic: e, label: [i.label, e.label].filter(Boolean).join(" + ") || "Day tickets only" });
    return res;
  }

  // Score every option, cheapest first.
  function plan(D, skiDays) {
    return options(D).map((o) => ({ ...o, ...price(skiDays, o.ikon, o.epic) })).sort((a, b) => a.cost - b.cost);
  }

  return { GROUPS, inBlackout, seasonCover, poolCovers, price, options, plan };
});
