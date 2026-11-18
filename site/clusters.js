"use strict";
// Find trips → Multi-mountain view. Math lives in cluster-core.js (window.PFCluster); this file only renders.
window.PFClusterUI = (function () {
  const C = () => window.PFCluster;
  const hrs = (m) => `${Math.round(m / 6) / 10} h`;
  const short = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const place = (id) => (D.places || {})[id] ? id : (D.resorts.find((r) => r.id === id) || { name: id }).name;
  const rname = (id) => (D.resorts.find((r) => r.id === id) || { name: id }).name;

  // Every (depart, return) window that has at least one priced leg for this variant's length.
  function windowsFor(variant, origins) {
    const set = new Set();
    for (const m of variant.travel_modes) for (const o of origins) {
      if (m.kind === "rt") {
        for (const wk of Object.keys((D.cluster_routes || {})[`${o}-${m.arrive}`] || {})) {
          const [d, r] = wk.split("|");
          if (C().addDays(d, variant.nights) === r) set.add(d);
        }
      } else for (const d of Object.keys((D.oneway || {})[`${o}-${m.arrive}`] || {})) set.add(d);
    }
    return [...set].sort();
  }

  function modeName(m) {
    return m.kind === "oj" ? `Fly into ${m.arrive}, home from ${m.depart}` : `Round trip into ${m.arrive}`;
  }

  // Price one variant for one origin + depart date: both travel modes, timing notes, drive totals.
  function evaluate(cluster, variant, origin, depart, opts, pass) {
    const ret = C().addDays(depart, variant.nights);
    const status = C().passStatus(D, variant, depart, pass.id);
    const now = Date.now();
    const modes = variant.travel_modes.map((m) => {
      const q = C().modeQuote(D, m, origin, depart, ret, opts, now);
      q.drive = C().driveFor(variant, m, D.drives, D.drive_cautions);
      q.timing = q.total != null ? C().timing(q, q.drive) : { provisional: true, notes: [] };
      return q;
    });
    const cmp = C().compare(modes);
    return { cluster, variant, origin, depart, ret, status, modes, cmp, snow: C().snow(D, variant, depart) };
  }

  function render(opts, pass, origins) {
    const cards = [];
    let hidden = 0, waiting = 0;
    for (const cluster of D.clusters || []) for (const variant of cluster.variants) {
      if (opts.shape !== "any" && String(variant.nights) !== opts.shape) continue;
      const all = [];
      for (const o of origins) for (const d of windowsFor(variant, [o])) {
        if (opts.month !== "all" && d.slice(5, 7) !== opts.month) continue;
        all.push(evaluate(cluster, variant, o, d, opts, pass));
      }
      const ok = all.filter((x) => x.status.qualifies);
      const priced = ok.filter((x) => x.cmp.best);
      if (!all.length) continue;
      if (!ok.length) { // only mention trips where the pass covers at least one of the mountains
        if (variant.stops.some((st) => { const r = D.resorts.find((y) => y.id === st.resort); return r && r.access[pass.id] != null; })) hidden++;
        continue;
      }
      if (!priced.length) { waiting++; continue; }
      const key = opts.sort === "snow" ? (x) => -(x.snow.score || 0) * 10000 + x.cmp.best.total : (x) => x.cmp.best.total;
      priced.sort((a, b) => key(a) - key(b));
      cards.push({ best: priced[0], more: priced.slice(1, 8), blocked: all.length - ok.length, key: key(priced[0]) });
    }
    cards.sort((a, b) => a.key - b.key);

    $("sort-help").textContent = opts.sort === "snow"
      ? "Best snow ranks multi-mountain trips by the historical snow rating of the days you'd actually ski (not a forecast). Flight cost breaks ties."
      : "Multi-mountain trips are ranked by estimated flights + board bag. Snow is shown on each card but isn't mixed into the ranking yet.";
    const extra = [hidden && `${hidden} trip${hidden > 1 ? "s" : ""} hidden because fewer than 2 of its mountains are on the ${pass.name} for those ski dates`,
      waiting && `${waiting} waiting for their first flight scan`].filter(Boolean).join("; ");
    $("summary").textContent = (cards.length
      ? `${cards.length} multi-mountain trip${cards.length > 1 ? "s" : ""} where the ${pass.name} covers at least 2 of the mountains on your ski days.`
      : "") + (extra ? ` (${extra}.)` : "");
    $("cards").innerHTML = cards.length ? cards.map((c) => card(c, pass, opts)).join("")
      : `<div class="empty"><strong>No multi-mountain trips priced yet for this filter.</strong>
          <p class="hint">One-way and week-long fares are scanned with leftover search budget, so they fill in over a few days. Try another pass, month or trip length.</p></div>`;
  }

  // ---- Presentation (Modern Travel Search, DESIGN_SPEC.md §5): itinerary first, then flight options ----
  const stopsText = (n) => (n ? `${n} stop${n > 1 ? "s" : ""}` : "nonstop");
  let uid = 0; // unique ids for the "What's this?" toggles within one render

  function legLine(l, kind) {
    if (!l.best) return `<li class="leg"><span class="leg-route">${esc(l.label)}</span> <span class="meta">${l.data ? "no fare after your filters" : "not priced yet"}</span></li>`;
    const b = l.best;
    const times = b.dep && b.arr ? ` · ${b.dep}–${b.arr}` : "";
    const bag = b.bag ? ` + $${b.bag} bag${kind === "rt" ? " (both ways" + (b.bagEstimated ? ", estimated: mixed airlines" : "") + ")" : ""}` : "";
    const age = l.age == null ? "" : l.age < 48 ? `checked ${Math.max(1, Math.round(l.age))} h ago` : `checked ${Math.round(l.age / 24)} days ago`;
    return `<li class="leg"><div class="row"><span class="leg-route">${esc(l.label)}</span><strong>$${b.total}</strong></div>
      <div class="meta">$${b.fare} fare${bag} · ${esc(b.airline)} · ${stopsText(b.stops)}${times} · <span${l.stale ? ' class="stale"' : ""}>${age}${l.stale ? " (may be out of date)" : ""}</span></div>
      ${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Check flights ${esc(l.label.replace(/[→⇄]/g, "to"))} for these dates (opens in a new tab)">Check flights for these dates <span aria-hidden="true">↗</span></a>` : ""}</li>`;
  }

  function modeBlock(q, isBest, bothPriced) {
    const route = q.drive.segs.filter((s) => !s.dayTrip).map((s) => s.from).concat(q.drive.segs.filter((s) => !s.dayTrip).slice(-1).map((s) => s.to))
      .map(place).join(" → ");
    const cautions = [...new Set(q.drive.segs.map((s) => s.caution).filter(Boolean))];
    const dayTrips = q.drive.segs.filter((s) => s.dayTrip).length;
    const total = q.total != null ? `<span class="mode-total">$${q.total}</span>` : `<span class="meta">${esc(q.reason || "not priced")}</span>`;
    // Only ever claim "cheapest flights": lodging, rental car and lift costs aren't priced here.
    const tag = isBest ? `<span class="tag">${bothPriced ? "Cheapest flights" : "Only priced option"}</span>` : "";
    return `<section class="mode${isBest ? " best-mode" : ""}" aria-label="${esc(modeName(q.mode))}">
      <div class="mode-head"><h4>${esc(modeName(q.mode))}</h4>${tag}</div>
      <div class="mode-price"><span class="fc-price-label">Estimated flights${q.legs.some((l) => l.best && l.best.bag) ? " + board bag" : ""}</span>${total}</div>
      <ul class="legs">${q.legs.map((l) => legLine(l, q.kind)).join("")}</ul>
      <p class="mode-drive"><span class="lbl">Driving</span> ${hrs(q.drive.minutes)} total (${esc(route)}${dayTrips ? `, plus ${dayTrips} day trip${dayTrips > 1 ? "s" : ""}` : ""})${q.drive.complete ? "" : " · some drives not mapped"}</p>
      ${cautions.length ? `<p class="mode-caution">Winter roads: ${esc(cautions.join(", "))}</p>` : ""}
      ${q.timing.notes.map((n) => `<p class="caution">⚠ ${esc(n)}</p>`).join("")}
    </section>`;
  }

  // Vertical day-by-day timeline for the cheapest travel mode: transfer days map in order onto the ground-route drives.
  function timeline(x, q) {
    const days = C().days(x.variant, x.depart);
    const segs = q.drive.segs.filter((s) => !s.dayTrip);
    let i = 0;
    return `<ol class="days">${days.map((d) => {
      const bits = [];
      if (d.fly === "out") bits.push(`<span class="act fly">Fly</span> ${x.origin} → ${q.mode.arrive}`);
      if (d.ski) bits.push(`<span class="act ski">Ski</span> ${esc(rname(d.ski))}`);
      if (d.drive && segs[i]) { const s = segs[i++]; bits.push(`<span class="act drive">Drive</span> ${hrs(s.min || 0)} to ${esc(place(s.to))}`); }
      if (d.fly === "back") bits.push(`<span class="act fly">Fly</span> ${q.mode.depart} → ${x.origin}`);
      if (!bits.length) bits.push(`<span class="act rest">Free day</span>`);
      const st = x.status.stops.find((s) => d.ski === s.resort);
      const off = st && st.uncovered && st.uncovered.includes(d.date);
      return `<li${off ? ' class="off"' : ""}><span class="d">${short(d.date)}</span><span class="what">${bits.join(" ")}${off ? ' <span class="flag warn">Not on your pass this day</span>' : ""}</span></li>`;
    }).join("")}</ol>`;
  }

  function card(c, pass) {
    const x = c.best, q = x.cmp.best, other = x.modes.find((m) => m !== q);
    const s = x.status, id = `cl${++uid}`;
    const covered = s.stops.filter((t) => ["valid", "partial", "unverified"].includes(t.status)).length;
    const passLine = `${covered} resorts covered for your ${esc(pass.name)} on the planned ski dates (${s.passDays} of ${s.skiDays} ski days)`;
    const stops = s.stops.filter((t) => t.dates.length).map((t) => {
      const label = { valid: "on your pass", partial: `${t.covered} of ${t.dates.length} days on your pass`, unverified: "pass access needs verification", invalid: "your pass doesn't cover these days (not on it, blacked out or over the limit): day ticket" }[t.status];
      const tk = D.tickets[t.resort];
      // Purchase-affecting detail is shown, not hidden in a hover tooltip.
      const ticket = t.status === "invalid" || t.status === "partial" ? ` · typical day ticket about $${tk ? tk.typical : "?"} (not included)` : "";
      return `<li class="${t.status === "valid" ? "ok" : t.status === "invalid" ? "bad" : "warn"}"><strong>${esc(rname(t.resort))}</strong>: ${t.dates.length} ski day${t.dates.length > 1 ? "s" : ""}, ${label}${ticket}</li>`;
    }).join("");
    const g = C().gradeOf(x.snow.score);
    const perStop = Object.entries(x.snow.stops).map(([r, v]) => `<span class="per-stop">${esc(rname(r))} ${gradeBadge({ score: v.score }, true)}</span>`).join(" ");
    const snowTip = `Historical snow conditions for your ${x.snow.days} planned ski days — not a forecast. Each ski day is rated against every mountain and day we track (typical base + usual new snow over the prior week), then averaged over the days you ski.`;
    const snowBlock = g
      ? `<div class="cl-snow-row">${gradeBadge({ score: x.snow.score })} ${perStop} <button type="button" class="tip" aria-expanded="false" aria-controls="${id}-snow">What's this?</button><span class="tip-text" id="${id}-snow" hidden>${esc(snowTip)}</span></div>
         <p class="meta">Historical snow for your planned ski days (${x.snow.days} of ${x.variant.nights + 1} trip days) — not a forecast.</p>`
      : `<p class="meta">Not available yet</p>`;
    let cmpLine = "";
    if (x.cmp.diff != null) {
      const dd = q.drive.minutes - x.cmp.other.drive.minutes;
      const drv = Math.abs(dd) >= 30 ? `, ${dd > 0 ? "but adds" : "and saves"} about ${hrs(Math.abs(dd))} of driving` : "";
      cmpLine = `${q.kind === "oj" ? `Open-jaw flights are $${x.cmp.diff} cheaper than a round trip into ${x.cmp.other.mode.arrive}` : `A round trip into ${q.mode.arrive} is $${x.cmp.diff} cheaper on flights than the open-jaw`} (estimated flights${q.legs[0].best && q.legs[0].best.bag ? " + board bag" : ""} only)${drv}.`;
    }
    else if (other) cmpLine = `${modeName(other.mode)}: ${other.reason || "not priced yet"}.`;
    const exclusions = `Not included: rental car${x.modes.some((m) => m.kind === "oj") ? ", one-way drop-off charges (some companies need advance approval or don't allow every drop-off)" : ""}, fuel, lodging, lift tickets and food.`;
    const more = c.more.map((y) => `<tr><td>${short(y.depart)} → ${short(y.ret)}</td><td>${y.origin}</td><td>${esc(y.cmp.best.kind === "oj" ? "open-jaw" : "round trip")}</td>
      <td class="num">$${y.cmp.best.total}</td><td class="num">${y.snow.score != null ? gradeBadge({ score: y.snow.score }, true) : "–"}</td></tr>`).join("");
    const bothPriced = x.cmp.diff != null;
    return `<article class="card cluster" aria-labelledby="${id}-h">
      <header class="cl-head">
        <div><h2 id="${id}-h">${esc(x.variant.label)}</h2><p class="meta">${esc(x.cluster.name)} · ${esc(x.cluster.region)}</p></div>
        <ul class="cl-facts"><li>${x.variant.nights} nights</li><li>${short(x.depart)} → ${short(x.ret)}</li><li>${covered} resorts on your pass</li></ul>
      </header>
      <div class="cl-summary">
        <div class="fc-price-label">Cheapest estimated flights${q.legs[0].best && q.legs[0].best.bag ? " + board bag" : ""}${q.bagEstimated ? " (bag fee estimated)" : ""}</div>
        <div class="price">$${q.total}</div>
        <p class="meta">${esc(modeName(q.mode))} from ${x.origin}</p>
        ${cmpLine ? `<p class="cl-cmp">${cmpLine}</p>` : ""}
      </div>
      <div class="cl-body">
        <section class="cl-timeline" aria-labelledby="${id}-days"><h3 id="${id}-days" class="cl-h">Your days</h3>${timeline(x, q)}
          ${q.timing.provisional ? `<p class="note">Flight times aren't available for every leg, so this day plan is provisional.</p>` : ""}</section>
        <div class="cl-side">
          <section aria-labelledby="${id}-pass"><h3 id="${id}-pass" class="cl-h">Pass coverage</h3>
            <p>${s.needsVerification ? `<span class="flag warn">Pass access needs verification</span> ` : ""}${passLine}</p>
            <ul class="cl-stops">${stops}</ul></section>
          <section aria-labelledby="${id}-snowh"><h3 id="${id}-snowh" class="cl-h">Historical snow on your ski days</h3>${snowBlock}</section>
        </div>
      </div>
      <section class="cl-modes" aria-labelledby="${id}-fl"><h3 id="${id}-fl" class="cl-h">Flight options</h3>
        <div class="cl-mode-grid">${x.modes.map((m) => modeBlock(m, m === q, bothPriced)).join("")}</div>
        <p class="note">Drive times: ${esc(D.drive_source || "estimates")}.</p></section>
      ${more ? `<details class="fc-more"><summary>More dates</summary><table><caption class="sr-only">Other dates for ${esc(x.variant.label)}</caption><thead><tr><th scope="col">Dates</th><th scope="col">From</th><th scope="col">Flights</th><th scope="col" class="num">Flights + bag</th><th scope="col" class="num">Snow</th></tr></thead><tbody>${more}</tbody></table></details>` : ""}
      ${c.blocked ? `<p class="note">${c.blocked} other date${c.blocked > 1 ? "s" : ""} hidden: fewer than 2 resorts on your pass for those ski days (blackouts or day limits).</p>` : ""}
      <div class="cl-excl"><p>${esc(exclusions)}</p>${(x.cluster.notes || []).map((n) => `<p>${esc(n)}</p>`).join("")}</div>
    </article>`;
  }

  return { render };
})();
