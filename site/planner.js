"use strict";
// Season planner: is a pass worth it? Prices every combination of an Ikon product and an Epic product.
(() => {
  const $ = (id) => document.getElementById(id);
  const DAY = 864e5;
  const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
  let PF, D, trips = [], ticketOverride = {};

  // Tabs work even before data loads.
  for (const [tab, view] of [["tab-find", "view-find"], ["tab-plan", "view-plan"]]) {
    $(tab).addEventListener("click", () => {
      for (const [t, v] of [["tab-find", "view-find"], ["tab-plan", "view-plan"]]) {
        $(t).setAttribute("aria-selected", t === tab); $(v).hidden = v !== view;
      }
      document.body.dataset.view = view;
    });
  }

  // Data may finish loading before or after this script runs; handle both.
  if (window.PF) setTimeout(init); else document.addEventListener("pf-ready", init, { once: true });

  function init() {
    if (D) return;
    PF = window.PF; D = PF.D;
    try {
      trips = JSON.parse(localStorage.getItem("pf-trips") || "[]");
      ticketOverride = JSON.parse(localStorage.getItem("pf-tickets") || "{}");
    } catch (e) {}
    if (!trips.length) trips = [{ resort: "", win: "", days: 3 }];
    $("add-trip").addEventListener("click", () => { trips.push({ resort: "", win: "", days: 3 }); draw(); });
    $("bag").addEventListener("change", draw);
    document.addEventListener("pf-filters", draw);
    draw();
  }

  const resortById = (id) => D.resorts.find((r) => r.id === id);
  // Ski dates for a trip: start on arrival day or the day after (default), never past the return flight day.
  function skiDatesISO(t) {
    const [dep, ret] = t.win.split("|");
    const out = [];
    for (let k = 0; k < t.days; k++) {
      const d = addDays(dep, k + (t.first === "0" ? 0 : 1));
      if (d > ret) break;
      out.push(d);
    }
    return out;
  }
  const skiDates = (t) => skiDatesISO(t).map((d) => PF.fmtDate(d).replace(/^\w+, /, ""));
  const ticket = (id) => ticketOverride[id] ?? D.tickets[id]?.typical ?? 150;

  function flightOptions(r) {
    const out = [];
    for (const o of D.origins) for (const ap of r.airports) {
      for (const [wk, win] of Object.entries(D.routes[`${o}-${ap.code}`] || {})) {
        const q = PF.bestQuote(win, PF.opts());
        if (q) out.push({ key: `${o}-${ap.code}|${wk}`, wk, o, ap: ap.code, q, url: win.url });
      }
    }
    // cheapest per date window
    const best = {};
    for (const x of out) if (!best[x.wk] || x.q.total < best[x.wk].q.total) best[x.wk] = x;
    return Object.values(best).sort((a, b) => a.wk.localeCompare(b.wk));
  }

  function draw() {
    const regions = [...new Set(D.resorts.map((r) => r.region))];
    const resortSelect = (sel) => `<option value="">Choose a mountain…</option>` + regions.map((g) =>
      `<optgroup label="${g}">${D.resorts.filter((r) => r.region === g).sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${PF.esc(r.name)}</option>`).join("")}</optgroup>`).join("");

    $("trips").querySelector("tbody").innerHTML = trips.map((t, i) => {
      const r = t.resort && resortById(t.resort);
      const fl = r ? flightOptions(r) : [];
      const chosen = fl.find((x) => x.wk === t.win);
      const winSel = r ? `<select data-i="${i}" data-f="win"><option value="">No flight (drive / not sure)</option>${fl.map((x) => {
        const [d, rt] = x.wk.split("|");
        return `<option value="${x.wk}" ${x.wk === t.win ? "selected" : ""}>${PF.fmtDate(d)} → ${PF.fmtDate(rt)} · $${x.q.total}</option>`;
      }).join("")}</select>` : `<span class="note">pick a mountain</span>`;
      return `<tr>
        <td><select data-i="${i}" data-f="resort">${resortSelect(t.resort)}</select></td>
        <td>${winSel}</td>
        <td class="num"><input type="number" min="1" max="60" value="${t.days}" data-i="${i}" data-f="days">
          ${t.win ? `<select data-i="${i}" data-f="first" title="Blackout checks use these exact ski dates"><option value="1" ${t.first !== "0" ? "selected" : ""}>from day after arrival</option><option value="0" ${t.first === "0" ? "selected" : ""}>from arrival day</option></select>` : ""}
          ${t.win ? `<div class="note">${skiDates(t).join(", ")}${skiDates(t).length < t.days ? ` <span class="stale">(only ${skiDates(t).length} ski day${skiDates(t).length === 1 ? "" : "s"} fit before your return flight)</span>` : ""}</div>` : ""}</td>
        <td class="num">${r ? `<input type="number" min="0" value="${ticket(r.id)}" data-tk="${r.id}" title="${D.tickets[r.id]?.basis === "cited" ? "From published 2026-27 prices" : "Estimate"}; edit to use your own price">` : ""}</td>
        <td class="num">${chosen ? `<a href="${PF.esc(chosen.url)}" target="_blank" rel="noopener">$${chosen.q.total}</a>` : "–"}</td>
        <td><button class="icon-btn" data-del="${i}" aria-label="Remove trip">×</button></td></tr>`;
    }).join("");

    const tb = $("trips");
    tb.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => {
      const t = trips[+el.dataset.i], f = el.dataset.f;
      t[f] = f === "days" ? Math.max(1, +el.value || 1) : el.value;
      if (f === "resort") t.win = "";
      save(); draw();
    }));
    tb.querySelectorAll("[data-tk]").forEach((el) => el.addEventListener("change", () => {
      ticketOverride[el.dataset.tk] = Math.max(0, +el.value || 0); save(); draw();
    }));
    tb.querySelectorAll("[data-del]").forEach((el) => el.addEventListener("click", () => {
      trips.splice(+el.dataset.del, 1); save(); draw();
    }));
    results();
  }

  function save() {
    try { localStorage.setItem("pf-trips", JSON.stringify(trips)); localStorage.setItem("pf-tickets", JSON.stringify(ticketOverride)); } catch (e) {}
  }

  // Pass math lives in planner-core.js (window.PFCore) so it can be unit-tested.

  // Plain-language buying advice for the cheapest option.
  function advice(best, base, scored, totalDays, flights, name) {
    const $$ = (n) => `$${n.toLocaleString()}`;
    const where = (days) => {
      const list = Object.entries(days).map(([n, k]) => `${PF.esc(n)} (${k} day${k > 1 ? "s" : ""})`);
      return list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list.at(-1) : list[0] || "";
    };
    const steps = best.parts.filter((p) => Object.keys(p.days).length).map((p) => {
      if (p.label === "Day tickets") return `Buy day tickets at ${where(p.days)}, about ${$$(p.cost)}.`;
      const pool = p.label.match(/^(.*) (\d)-day$/);
      const what = pool ? `a ${pool[2]}-day ${pool[1]}` : `the ${p.label}`;
      return `Buy ${PF.esc(what)} (${$$(p.cost)}) and use it at ${where(p.days)}.`;
    });
    const seasonBest = scored.find((s) => s.ikon.kind === "season" || s.epic.kind === "season");
    const days = `${totalDays} day${totalDays > 1 ? "s" : ""}`;
    let save;
    if (best === base) save = `No pass saves money for this plan. Day tickets are the cheapest way to go.`;
    else {
      save = `You'll save <strong>${$$(base.cost - best.cost)}</strong> compared with buying a day ticket for every day (${$$(base.cost)})`;
      if (seasonBest && seasonBest !== best) save += `, and <strong>${$$(seasonBest.cost - best.cost)}</strong> compared with the best season-pass option (${PF.esc(name(seasonBest))}, ${$$(seasonBest.cost)})`;
      save += ".";
    }
    const trip = flights ? `Estimated lift access + flights${PF.opts().bag ? " (with board bags)" : ""}: about <strong>${$$(best.cost + flights)}</strong>. Lodging, ground transport and meals aren't included.` : "";
    const verifiedBest = scored.find((s) => !s.unverified);
    const caution = best.unverified
      ? `<p class="caution">⚠ This depends on pass coverage we haven't verified (the Ikon Session Pass resort list, or a resort's day limit). Check ikonpass.com or epicpass.com before buying.${verifiedBest ? ` The cheapest option using only verified rules is <strong>${PF.esc(name(verifiedBest))}</strong> at ${$$(verifiedBest.cost)}.` : ""}</p>` : "";
    return `<div class="best">
      <div class="meta">The cheapest way to ski your ${days}</div>
      <div class="row"><span class="price">${$$(best.cost)}</span><span class="break">in lift costs</span></div>
      <ol class="steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <p class="meta">${save} ${trip}</p>${caution}</div>`;
  }

  // "Epic Day Pass 3-day ($384): Park City ×3 · Day tickets ($375): Brighton ×3"
  function describe(s) {
    return s.parts.map((p) => {
      const where = Object.entries(p.days).map(([n, k]) => `${PF.esc(n)} ×${k}`).join(", ");
      return `<strong>${PF.esc(p.label)}</strong> ($${p.cost.toLocaleString()}): ${where || `<span class="note">no days used here</span>`}`;
    }).join(" · ");
  }

  function results() {
    const planned = trips.map((t) => ({ t, r: t.resort && resortById(t.resort) })).filter((x) => x.r);
    if (!planned.length) { $("plan-results").innerHTML = ""; return; }
    const skiDays = [];
    let flights = 0;
    for (const { t, r } of planned) {
      const fl = t.win ? flightOptions(r).find((x) => x.wk === t.win) : null;
      if (fl) flights += fl.q.total;
      const dates = t.win ? skiDatesISO(t) : Array(t.days).fill("");
      for (const date of dates) skiDays.push({ r, price: ticket(r.id), date });
    }
    const scored = window.PFCore.plan(D, skiDays);
    const base = scored.find((s) => s.label === "Day tickets only");
    const best = scored[0];
    const totalDays = skiDays.length;
    const name = (s) => s.label === "Day tickets only" ? s.label : s.label + (s.tickets ? ` + ${s.tickets} day ticket${s.tickets > 1 ? "s" : ""}` : "");
    const rows = scored.slice(0, 10).map((s, i) => `<tr class="${i === 0 ? "top" : ""}"><td>${PF.esc(name(s))}${s.unverified ? ` <span class="chip warn" title="Relies on pass coverage we haven't verified on the official site">unverified</span>` : ""}
        <div class="note">${describe(s)}</div></td>
      <td class="num">$${s.cost.toLocaleString()}</td>
      <td class="num">${s.cost < base.cost ? `save $${(base.cost - s.cost).toLocaleString()}` : s === base ? "—" : `+$${(s.cost - base.cost).toLocaleString()}`}</td>
      <td class="num">$${(s.cost + flights).toLocaleString()}</td></tr>`).join("");
    $("plan-results").innerHTML = `<div class="result">
      ${advice(best, base, scored, totalDays, flights, name)}
      <table><thead><tr><th>Option · what covers which days</th><th class="num">Lift cost</th><th class="num">vs tickets</th><th class="num">+ flights</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Lift cost = pass price + any day tickets the pass doesn't cover (day limits, blackouts, or mountains not on that pass). Day-ticket prices are typical advance online prices (estimates unless marked as published), and you can edit them. Ikon Session 3/4-day and most Epic Day prices are estimates. <strong>Limits:</strong> adult prices; Ikon Session and Epic Day passes are treated as valid at every Ikon or Epic resort in our list (some products exclude certain resorts or dates, so confirm before buying); lodging, ground transport and meals aren't included. Blackouts are checked against the ski dates shown for each trip.</p>
    </div>`;
  }
})();
