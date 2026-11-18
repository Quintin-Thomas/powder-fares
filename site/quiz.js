"use strict";
// Plan tab: "Help me plan" quiz vs "I know my trips" planner. Plan math is in quiz-core.js (window.PFQuiz).
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY_MODE = "pf-plan-mode:v1", KEY_QUIZ = "pf-quiz:v1";
  const MONTHS = [["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"]];
  const DEFAULTS = { trips: null, months: [], shape: "either", priority: null, budget: "", pass: null, allowOffPass: false, regions: [] };
  let state = { step: 0, answers: { ...DEFAULTS }, done: false };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---- mode switch ----
  function setMode(mode) {
    $("mode-quiz").setAttribute("aria-pressed", mode === "quiz");
    $("mode-manual").setAttribute("aria-pressed", mode === "manual");
    $("quiz").hidden = mode !== "quiz";
    $("manual").hidden = mode !== "manual";
    if (mode) store.set(KEY_MODE, mode);
    if (mode === "quiz") draw();
  }
  $("mode-quiz").addEventListener("click", () => setMode("quiz"));
  $("mode-manual").addEventListener("click", () => setMode("manual"));

  function init() {
    try { const s = JSON.parse(store.get(KEY_QUIZ) || "null"); if (s && s.answers) state = { ...state, ...s, answers: { ...DEFAULTS, ...s.answers } }; } catch (e) {}
    const mode = store.get(KEY_MODE);
    setMode(mode === "quiz" || mode === "manual" ? mode : null);
    // Results follow the shared filters (From, board bag, excluded airlines).
    for (const ev of ["pf-filters"]) document.addEventListener(ev, () => state.done && draw());
    for (const id of ["origin", "bag"]) $(id).addEventListener("change", () => state.done && draw());
  }
  if (window.PF) setTimeout(init); else document.addEventListener("pf-ready", init, { once: true });

  const save = () => store.set(KEY_QUIZ, JSON.stringify(state));
  const esc = (s) => window.PF.esc(s);

  // ---- questions ----
  const Q = [
    { title: "How much do you want to ski this season?", valid: (a) => !!a.trips,
      body: (a) => radios("trips", [[1, "1 trip", "about 2 ski days"], [2, "2 trips", "about 4 ski days"], [4, "3–4 trips", "about 8 ski days"], [5, "5 trips", "about 10 ski days"]], a.trips) },
    { title: "When can you go?", valid: (a) => a.months.length > 0,
      body: (a) => `<div class="opts cols">${MONTHS.map(([v, t]) => check("months", v, t, a.months.includes(v))).join("")}</div>
        <div class="sub">Which days work?</div>${radios("shape", [["weekend", "Weekends", "Thu → Sun"], ["midweek", "Midweek", "Mon → Thu"], ["either", "Either"]], a.shape, true)}` },
    { title: "What matters most?", valid: (a) => !!a.priority,
      body: (a) => radios("priority", [["cost", "Lowest total cost", "flights + lift access"], ["snow", "Best snow", "historical conditions on your ski days"],
        ["explore", "Explore different regions", "spread trips across states and provinces"], ["marquee", "Big-name mountains", "well-known destination resorts"]], a.priority)
        + `<label class="sub">Max you'd spend on flights for the whole season (optional): $ <input type="number" min="0" step="50" data-q="budget" value="${esc(a.budget)}" placeholder="no limit"></label>` },
    { title: "Do you already have a pass?", valid: (a) => !!a.pass,
      body: (a) => radios("pass", [...window.PF.D.passes.map((p) => [p.id, `I have the ${p.name}`]), ["decide", "Not yet. Help me decide", "we'll compare passes and day tickets"]], a.pass)
        + (a.pass && a.pass !== "decide" ? `<label class="opt"><input type="checkbox" data-q="allowOffPass" ${a.allowOffPass ? "checked" : ""}> Also suggest mountains not on my pass (I'd buy day tickets)</label>` : "") },
    { title: "Where are you open to going?", valid: (a) => a.regions.length > 0,
      body: (a) => `<div class="opts cols">${[...Object.entries(window.PF.D.quiz.regions).map(([k, g]) => [k, g.label]), ["any", "Anywhere"]]
        .map(([v, t]) => check("regions", v, t, a.regions.includes(v))).join("")}</div>` },
  ];
  const radios = (name, list, cur, cols) => `<div class="opts${cols ? " cols" : ""}" role="radiogroup">${list.map(([v, t, sub]) =>
    `<label class="opt"><input type="radio" name="q-${name}" data-q="${name}" value="${v}" ${String(cur) === String(v) ? "checked" : ""}><span>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`).join("")}</div>`;
  const check = (name, v, t, on) => `<label class="opt"><input type="checkbox" data-q="${name}" value="${v}" ${on ? "checked" : ""}> ${esc(t)}</label>`;

  function draw() {
    if (!window.PF) return;
    if (state.done) return results();
    const a = state.answers, q = Q[state.step];
    $("quiz").innerHTML = `<div class="quiz">
      <div class="progress" aria-live="polite">Question ${state.step + 1} of ${Q.length}</div>
      <div class="bar" aria-hidden="true"><span style="width:${((state.step + 1) / Q.length) * 100}%"></span></div>
      <h2 id="q-title" tabindex="-1">${q.title}</h2>
      <div aria-labelledby="q-title">${q.body(a)}</div>
      <div class="nav"><button class="btn ghost" id="q-back" ${state.step === 0 ? "disabled" : ""}>Back</button>
        <button class="btn" id="q-next" ${q.valid(a) ? "" : "disabled"}>${state.step === Q.length - 1 ? "Show my plans" : "Next"}</button></div></div>`;
    $("quiz").querySelectorAll("[data-q]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.q;
      if (k === "months" || k === "regions") {
        let set = new Set(a[k]);
        if (el.checked) set.add(el.value); else set.delete(el.value);
        if (k === "regions") set = el.value === "any" && el.checked ? new Set(["any"]) : (set.delete("any"), set);
        a[k] = [...set];
      } else if (k === "allowOffPass") a[k] = el.checked;
      else if (k === "trips") a[k] = +el.value;
      else a[k] = el.value;
      save();
      if (k === "pass" || k === "regions") draw(); // these change what's shown
      else $("q-next").disabled = !q.valid(a);
    }));
    $("q-back").addEventListener("click", () => { state.step--; save(); draw(); focusTitle(); });
    $("q-next").addEventListener("click", () => {
      if (state.step < Q.length - 1) state.step++; else state.done = true;
      save(); draw(); focusTitle();
    });
  }
  const focusTitle = () => { const t = $("q-title") || $("r-title"); if (t) t.focus(); };

  // ---- results ----
  function results() {
    const PF = window.PF, D = PF.D, a = state.answers, o = PF.opts();
    const prefs = { trips: a.trips, months: a.months, shape: a.shape, priority: a.priority, budget: +a.budget || null,
      pass: a.pass, allowOffPass: a.allowOffPass, regions: a.regions };
    const r = window.PFQuiz.generateSeasonPlans({ data: D, prefs, opts: { ...o, tickets: window.PFPlanner ? window.PFPlanner.tickets() : {} }, now: Date.now() });
    const owned = a.pass !== "decide" ? D.passes.find((p) => p.id === a.pass) : null;
    const from = o.origin === "any" ? D.origins.join(" or ") : o.origin;
    const inherited = `From ${esc(from)} · board bag ${o.bag ? "included" : "not included"}${o.exclude.size ? ` · excluding ${esc([...o.exclude].join(", "))}` : ""}`;
    const L = r.limitations;
    const notes = [
      L.fewerTrips && "Some plans have fewer trips than you asked for: not enough priced trips fit your months with 10 days between trips.",
      L.fewerPlans,
      L.noMarquee && "None of the big-name mountains fit your dates and pass right now.",
      L.approximate && "With 4–5 trips there are too many combinations to check them all, so these are the best plans we found, not a guaranteed best.",
      L.stale && `${L.stale} fare${L.stale > 1 ? "s" : ""} older than 4 days left out.`,
      L.candidates < 20 && "Fares are still being collected for many routes, so options are limited. More fill in every day.",
    ].filter(Boolean);
    $("quiz").innerHTML = `<div class="quiz" style="max-width:none">
      <h2 id="r-title" tabindex="-1">${r.plans.length ? `Your season plan${r.plans.length > 1 ? "s" : ""}` : "No plans found yet"}</h2>
      <p class="meta">${inherited} · <a href="#" id="r-filters">change</a>. Ski days are the full days between your flights.${owned ? ` Assumes you haven't used any ${esc(owned.name)} days yet.` : ""}</p>
      ${notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}
      ${r.plans.length ? `<div class="plans">${r.plans.map((p, i) => planCard(p, i, owned)).join("")}</div>`
        : `<p>Nothing fits those answers with the fares we have right now. Try more months, more regions, or fewer trips.</p>`}
      <div class="nav"><button class="btn ghost" id="r-edit">Change answers</button><button class="btn ghost" id="r-restart">Start over</button></div></div>`;
    $("r-edit").addEventListener("click", () => { state.done = false; state.step = 0; save(); draw(); focusTitle(); });
    $("r-restart").addEventListener("click", () => { state = { step: 0, answers: { ...DEFAULTS }, done: false }; save(); draw(); focusTitle(); });
    $("r-filters").addEventListener("click", (e) => { e.preventDefault(); $("origin").focus(); });
    $("quiz").querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => openInPlanner(r.plans[+b.dataset.load], owned)));
  }

  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const short = (iso) => window.PF.fmtDate(iso).replace(/^\w+, /, "");

  function planCard(p, i, owned) {
    const trips = p.trips.map((t) => `<li><div class="row"><strong>${esc(t.name)}</strong><span>${t.snow != null ? gradeBadge({ score: t.snow }, true) : ""}</span></div>
      <div>Ski ${t.skiDates.map(short).join(" & ")} <span class="meta">(${esc(t.region)})</span></div>
      <div class="meta">Fly ${window.PF.fmtDate(t.depart)} → ${window.PF.fmtDate(t.ret)} · ${t.origin}→${t.airport} · ${money(t.fare.total)} <a href="${esc(t.url)}" target="_blank" rel="noopener">check fares</a></div></li>`).join("");
    const l = p.lift;
    let pass;
    if (owned) {
      pass = `Your ${esc(owned.name)} covers ${l.ownedDays} of ${p.skiDays} ski days.` + (l.cost ? ` The rest: about ${money(l.cost)} (${esc(describeExtra(l, owned.name))}).` : " No extra lift costs.");
    } else {
      pass = l.label === "Day tickets only" ? `Day tickets are the cheapest way to ski these ${p.skiDays} days.`
        : `Cheapest way to pay for lifts: <strong>${esc(l.label)}${l.tickets ? ` + ${l.tickets} day ticket${l.tickets > 1 ? "s" : ""}` : ""}</strong>, saving ${money(l.savingsVsTickets)} vs day tickets for the same ${p.skiDays} days.`;
      if (l.label !== "Day tickets only") pass += ` <span class="meta">Check current availability on <a href="https://www.ikonpass.com" target="_blank" rel="noopener">ikonpass.com</a> / <a href="https://www.epicpass.com" target="_blank" rel="noopener">epicpass.com</a>.</span>`;
    }
    // Name exactly what isn't verified: a resort's day limit on the pass in use, or the Ikon Session resort list.
    const D = window.PF.D, passIds = D.passes.filter((x) => owned ? x.id === owned.id : l.label.includes(x.name)).map((x) => x.id);
    const flagged = p.trips.filter((t) => ((D.resorts.find((r) => r.id === t.resort) || {}).verify || []).some((id) => passIds.includes(id))).map((t) => t.name);
    const why = [flagged.length && `${flagged.join(" and ")}'s day limit on the ${owned ? owned.name : "pass"} isn't verified yet`,
      /Session/.test(l.label) && "the Ikon Session Pass resort list isn't published"].filter(Boolean).join("; ");
    const prov = p.provisional ? `<p class="caution">${owned ? "Check before relying on it" : "Provisional"}: ${esc(why || "some pass coverage isn't verified")}. Confirm on the official pass site${owned ? "" : " before buying"}.</p>` : "";
    return `<article class="plan-card${p.bestMatch ? " match" : ""}">
      <div class="row"><h3>${esc(p.label)}</h3>${p.bestMatch ? `<span class="chip low">Best match</span>` : ""}</div>
      <div class="meta">${esc(p.reason)}${p.snow != null ? ` · snow on your ski days: ${gradeBadge({ score: p.snow }, true)}` : ""}</div>
      <ul class="plan-trips">${trips}</ul>
      <div class="totals"><span>Flights${window.PF.opts().bag ? " + board bags" : ""}</span><span>${money(p.flights)}</span>
        <span>Lift access${owned ? " (beyond your pass)" : ""}</span><span>${money(l.cost)}</span>
        <span class="grand">Estimated total</span><span class="grand">${money(p.total)}</span></div>
      <p class="meta">${pass}</p>${prov}
      <p class="note">Not included: lodging, ground transport, food. Snow grades are historical, not a forecast.</p>
      <button class="btn" data-load="${i}">Open this plan in the planner</button>
    </article>`;
  }

  function describeExtra(l, ownedName) {
    return l.parts.filter((x) => x.label !== ownedName && Object.keys(x.days).length).map((x) => `${x.label}: ${Object.entries(x.days).map(([n, k]) => `${n} ×${k}`).join(", ")}`).join("; ");
  }

  function openInPlanner(plan, owned) {
    if (!window.PFPlanner) return;
    if (window.PFPlanner.hasTrips() && !confirm("Replace the trips already in your planner with this plan?")) return;
    const n = window.PFPlanner.load(plan.trips.map((t) => ({ resort: t.resort, win: t.win, days: t.skiDates.length })), owned ? owned.id : "");
    setMode("manual");
    if (n < plan.trips.length) alert(`${plan.trips.length - n} trip${plan.trips.length - n > 1 ? "s" : ""} couldn't be loaded because ${plan.trips.length - n > 1 ? "their" : "its"} fare is no longer available.`);
    $("trips").scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
