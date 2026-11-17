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
      : `<p class="empty">No multi-mountain trips priced yet for this filter. One-way and week-long fares are scanned with leftover search budget, so they fill in over a few days.</p>`;
  }

  function legLine(l, kind) {
    if (!l.best) return `<li>${esc(l.label)}: <span class="meta">${l.data ? "no fare after your filters" : "not priced yet"}</span></li>`;
    const b = l.best;
    const times = b.dep && b.arr ? ` · ${b.dep}–${b.arr}` : "";
    const bag = b.bag ? ` + $${b.bag} bag${kind === "rt" ? " (both ways" + (b.bagEstimated ? ", estimated: mixed airlines" : "") + ")" : ""}` : "";
    const age = l.age == null ? "" : l.age < 48 ? `checked ${Math.max(1, Math.round(l.age))} h ago` : `checked ${Math.round(l.age / 24)} days ago`;
    return `<li>${esc(l.label)}: <strong>$${b.total}</strong> <span class="meta">($${b.fare} fare${bag}) · ${esc(b.airline)}${b.stops ? `, ${b.stops} stop` : ", nonstop"}${times} · <span${l.stale ? ' class="stale"' : ""}>${age}</span></span>
      ${l.url ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener">Check flights for these dates</a>` : ""}</li>`;
  }

  function modeBlock(q, isBest) {
    const route = q.drive.segs.filter((s) => !s.dayTrip).map((s) => s.from).concat(q.drive.segs.filter((s) => !s.dayTrip).slice(-1).map((s) => s.to))
      .map(place).join(" → ");
    const cautions = [...new Set(q.drive.segs.map((s) => s.caution).filter(Boolean))];
    const dayTrips = q.drive.segs.filter((s) => s.dayTrip).length;
    const total = q.total != null ? `$${q.total}` : `<span class="meta">${esc(q.reason || "not priced")}</span>`;
    return `<div class="mode${isBest ? " best-mode" : ""}">
      <div class="row"><strong>${esc(modeName(q.mode))}</strong><span>${total}</span></div>
      <ul class="legs">${q.legs.map((l) => legLine(l, q.kind)).join("")}</ul>
      <div class="meta">Estimated driving: ${hrs(q.drive.minutes)} total (${esc(route)}${dayTrips ? `, plus ${dayTrips} day trip${dayTrips > 1 ? "s" : ""}` : ""})${q.drive.complete ? "" : " · some drives not mapped"}${cautions.length ? ` · ${esc(cautions.join(", "))}` : ""}</div>
      ${q.timing.notes.map((n) => `<div class="caution">⚠ ${esc(n)}</div>`).join("")}
    </div>`;
  }

  // Day-by-day strip for the winning travel mode: transfer days map in order onto the ground-route drives.
  function strip(x, q) {
    const days = C().days(x.variant, x.depart);
    const segs = q.drive.segs.filter((s) => !s.dayTrip);
    let i = 0;
    return `<ol class="days">${days.map((d) => {
      const bits = [];
      if (d.fly === "out") bits.push(`✈ ${x.origin}→${q.mode.arrive}`);
      if (d.ski) bits.push(`🎿 ${esc(rname(d.ski))}`);
      if (d.drive && segs[i]) { const s = segs[i++]; bits.push(`🚗 ${hrs(s.min || 0)} to ${esc(place(s.to))}`); }
      if (d.fly === "back") bits.push(`✈ ${q.mode.depart}→${x.origin}`);
      if (!bits.length) bits.push("rest / explore");
      const st = x.status.stops.find((s) => d.ski === s.resort);
      const off = st && st.uncovered && st.uncovered.includes(d.date);
      return `<li${off ? ' class="off"' : ""}><span class="d">${short(d.date)}</span> ${bits.join(" · ")}${off ? ' <span class="chip warn">not on pass this day</span>' : ""}</li>`;
    }).join("")}</ol>`;
  }

  function card(c, pass) {
    const x = c.best, q = x.cmp.best, other = x.modes.find((m) => m !== q);
    const s = x.status;
    const covered = s.stops.filter((t) => ["valid", "partial", "unverified"].includes(t.status)).length;
    const passLine = `${covered} resorts covered for your ${esc(pass.name)} on the planned ski dates (${s.passDays} of ${s.skiDays} ski days)`;
    const stopChips = s.stops.filter((t) => t.dates.length).map((t) => {
      const label = { valid: "on pass", partial: `${t.covered} of ${t.dates.length} days on pass`, unverified: "pass access needs verification", invalid: "not on pass: day ticket" }[t.status];
      const tk = D.tickets[t.resort];
      const tip = t.status === "invalid" || t.status === "partial" ? ` title="Typical day ticket about $${tk ? tk.typical : "?"} (not included)"` : "";
      return `<span class="chip ${t.status === "valid" ? "low" : t.status === "invalid" ? "high" : "warn"}"${tip}>${esc(rname(t.resort))}: ${t.dates.length} ski day${t.dates.length > 1 ? "s" : ""}, ${label}</span>`;
    }).join(" ");
    const g = C().gradeOf(x.snow.score);
    const perStop = Object.entries(x.snow.stops).map(([r, v]) => `${esc(rname(r))} ${gradeBadge({ score: v.score }, true)}`).join(" ");
    const snowLine = g
      ? `<div class="line"><span class="lbl">Snow</span> ${gradeBadge({ score: x.snow.score })} <span class="meta">${perStop}</span> <span class="info-i" title="Historical snow conditions for your ${x.snow.days} planned ski days — not a forecast. Each ski day is rated against every mountain and day we track (typical base + usual new snow over the prior week), then averaged over the days you ski.">ⓘ</span></div>
         <div class="meta">Historical snow for your planned ski days (${x.snow.days} of ${x.variant.nights + 1} trip days) — not a forecast.</div>`
      : `<div class="line"><span class="lbl">Snow</span> <span class="meta">not available yet</span></div>`;
    let cmpLine = "";
    if (x.cmp.diff != null) {
      const dd = q.drive.minutes - x.cmp.other.drive.minutes;
      const drv = Math.abs(dd) >= 30 ? `, ${dd > 0 ? "but adds" : "and saves"} about ${hrs(Math.abs(dd))} of driving` : "";
      cmpLine = `${q.kind === "oj" ? `Open-jaw flights are $${x.cmp.diff} cheaper than a round trip into ${x.cmp.other.mode.arrive}` : `A round trip into ${q.mode.arrive} is $${x.cmp.diff} cheaper on flights than the open-jaw`} (estimated flights${q.legs[0].best && q.legs[0].best.bag ? " + board bag" : ""} only)${drv}.`;
    }
    else if (other) cmpLine = `${modeName(other.mode)}: ${other.reason || "not priced yet"}.`;
    const exclusions = `Rental car${x.modes.some((m) => m.kind === "oj") ? ", one-way drop-off charges (some companies need advance approval or don't allow every drop-off)" : ""}, fuel, lodging, lift tickets and food are not included.`;
    const more = c.more.map((y) => `<tr><td>${short(y.depart)} → ${short(y.ret)}</td><td>${y.origin}</td><td>${esc(y.cmp.best.kind === "oj" ? "open-jaw" : "round trip")}</td>
      <td class="num">$${y.cmp.best.total}</td><td class="num">${y.snow.score != null ? gradeBadge({ score: y.snow.score }, true) : "–"}</td></tr>`).join("");
    return `<article class="card cluster">
      <div class="row"><h2>${esc(x.variant.label)}</h2><span class="meta">${x.variant.nights} nights</span></div>
      <div class="meta">${esc(x.cluster.name)} · ${esc(x.cluster.region)}</div>
      <div class="row"><span class="price">$${q.total}</span><span class="break">Estimated flights${q.legs[0].best && q.legs[0].best.bag ? " + board bag" : ""}${q.bagEstimated ? " (bag fee estimated)" : ""}</span></div>
      <div><strong>${short(x.depart)} → ${short(x.ret)}</strong><div class="meta">${esc(modeName(q.mode))} from ${x.origin}</div></div>
      ${cmpLine ? `<div class="meta">${cmpLine}</div>` : ""}
      ${strip(x, q)}
      ${q.timing.notes.map((n) => `<div class="caution">⚠ ${esc(n)}</div>`).join("")}
      <div class="line"><span class="lbl">Pass</span> ${s.needsVerification ? "Pass access needs verification · " : ""}${passLine}</div>
      <div>${stopChips}</div>
      ${snowLine}
      <details><summary>Flight and driving details</summary>${x.modes.map((m) => modeBlock(m, m === q)).join("")}
        <p class="note">Drive times: ${esc(D.drive_source || "estimates")}.${q.timing.provisional ? " Flight times aren't available for every leg, so the day plan is provisional." : ""}</p></details>
      ${more ? `<details><summary>More dates</summary><table><thead><tr><th>Dates</th><th>From</th><th>Flights</th><th class="num">Flights + bag</th><th class="num">Snow</th></tr></thead><tbody>${more}</tbody></table></details>` : ""}
      ${c.blocked ? `<p class="note">${c.blocked} other date${c.blocked > 1 ? "s" : ""} hidden: fewer than 2 resorts on your pass for those ski days (blackouts or day limits).</p>` : ""}
      <div class="caution">${esc(exclusions)}${(x.cluster.notes || []).map((n) => ` ${esc(n)}`).join("")}</div>
    </article>`;
  }

  return { render };
})();
