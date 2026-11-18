"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
let D;

function loadData() {
  $("summary").textContent = "Loading prices and snow…";
  fetch("data.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(start)
    .catch((e) => {
      $("summary").textContent = "";
      $("cards").innerHTML = `<div class="error" role="alert"><strong>Couldn't load trip data.</strong> ${esc(e.message)}. Check your connection, then try again.<div><button class="btn" id="retry">Try again</button></div></div>`;
      $("retry").addEventListener("click", loadData);
    });
}
loadData();

function start(data) {
  D = data;
  $("pass").innerHTML = D.passes.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("origin").innerHTML += D.origins.map((o) => `<option value="${o}">${o} only</option>`).join("");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("pf") || "{}"); for (const k in saved) if ($(k)) $(k)[typeof saved[k] === "boolean" ? "checked" : "value"] = saved[k]; } catch (e) {}
  syncShape(saved.shape);
  $("kind").addEventListener("change", () => syncShape());
  setupAirlines();
  // Same controls as before (every filter select + the board-bag box); airline boxes have their own handler.
  document.querySelectorAll(".controls select, #bag").forEach((el) => el.addEventListener("change", render));
  const h = D.health;
  $("updated").textContent = `Page built ${new Date(D.generated + (/Z$/.test(D.generated) ? "" : "Z")).toLocaleString()}.` + (h
    ? ` Last flight scan finished ${new Date(h.finished).toLocaleString()}: ${h.ok} of ${h.searched} searches succeeded. ${h.windows_checked_7d} of ${h.windows_total} route-and-date combinations checked in the past 7 days.`
    : "");
  if (D.enso && D.enso.analogs && D.enso.analogs.length) {
    const yrs = D.enso.analogs.map((y) => `${y}–${String(y + 1).slice(2)}`).join(", ");
    // One line by default; the full NOAA summary and method sit behind "Details" (same text as before).
    $("enso").innerHTML = `<details><summary><strong>This winter: ${esc(D.enso.label)}.</strong> <span>Snow ratings account for it.</span> <span class="more">Details</span></summary>
      <p>${esc(D.enso.summary)} Historical snow ratings lean on how each mountain did in the ${D.enso.analogs.length} most similar past winters (${yrs}), compared with all winters since 1980. <a href="${esc(D.enso.source)}" target="_blank" rel="noopener">NOAA outlook<span class="sr-only"> (opens in a new tab)</span></a></p></details>`;
    $("enso").hidden = false;
  }
  render();
  window.PF = { D, bestQuote, fmtDate, esc, opts: () => ({ bag: $("bag").checked, exclude: EXCLUDE, origin: $("origin").value }) };
  document.dispatchEvent(new Event("pf-ready"));
}

// Trip-length choices depend on the trip type: 3-night single trips vs 5/7-night multi-mountain trips.
const SHAPES = {
  single: [["any", "Any"], ["0", "Mon–Thu (midweek)"], ["3", "Thu–Sun (weekend)"]],
  multi: [["any", "5 or 7 nights"], ["5", "5 nights (Sat–Thu)"], ["7", "7 nights (Sat–Sat)"]],
};
function syncShape(want) {
  const list = SHAPES[$("kind").value] || SHAPES.single, cur = want || $("shape").value;
  $("shape").innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  $("shape").value = list.some(([v]) => v === cur) ? cur : "any";
}

function bagFee(airlines) {
  return Math.max(...airlines.map((a) => D.airlines.fees[a] ?? D.airlines.default_fee));
}

// ---- Exclude-airlines picker ----
let EXCLUDE = new Set();
function setupAirlines() {
  const all = new Set();
  for (const src of [D.routes, D.cluster_routes || {}, D.oneway || {}])
    for (const wins of Object.values(src)) for (const w of Object.values(wins))
      for (const name of Object.keys(w.by_airline)) name.split(", ").forEach((a) => all.add(a));
  try { EXCLUDE = new Set(JSON.parse(localStorage.getItem("pf-exclude") || "null") || D.airlines.default_exclude); }
  catch (e) { EXCLUDE = new Set(D.airlines.default_exclude); }
  const reasons = D.airlines.exclude_reasons || {};
  $("airline-list").innerHTML = [...all].sort().map((a) =>
    `<label><input type="checkbox" value="${esc(a)}" ${EXCLUDE.has(a) ? "checked" : ""}> ${esc(a)}</label>`).join("")
    + Object.entries(reasons).map(([a, why]) => `<div class="why"><strong>${esc(a)}:</strong> ${esc(why)}</div>`).join("");
  const sync = () => {
    $("airline-summary").textContent = EXCLUDE.size ? `Excluding: ${[...EXCLUDE].join(", ")}` : "Exclude airlines";
    try { localStorage.setItem("pf-exclude", JSON.stringify([...EXCLUDE])); } catch (e) {}
  };
  $("airline-list").addEventListener("change", (e) => {
    if (e.target.checked) EXCLUDE.add(e.target.value); else EXCLUDE.delete(e.target.value);
    sync(); render(); document.dispatchEvent(new Event("pf-filters"));
  });
  document.addEventListener("click", (e) => { if (!$("airlines").contains(e.target)) $("airlines").open = false; });
  // Escape closes the picker and puts focus back on its toggle.
  $("airlines").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("airlines").open) { $("airlines").open = false; $("airline-summary").focus(); }
  });
  sync();
}

// Snow score (0-100, ranked across every mountain and week) -> letter grade.
const GRADES = [[85, "A", "Excellent"], [70, "B", "Good"], [50, "C", "Fair"], [30, "D", "Thin"], [0, "F", "Poor"]];
function grade(snow) {
  if (!snow) return null;
  const [, letter, word] = GRADES.find(([min]) => snow.score >= min);
  return { letter, word };
}
function gradeBadge(snow, small) {
  const g = grade(snow);
  if (!g) return `<span class="grade" role="img" aria-label="Snow grade not available">–</span>`;
  const tip = `${g.word}: better than ${snow.score}% of mountain-weeks we track. Based on the usual base depth and fresh snow that week${snow.forecast_fresh != null ? " plus the 16-day forecast" : ""}.`;
  // The spoken label carries the meaning; the letter stays visible, colour is only a reinforcement.
  return `<span class="grade g-${g.letter}${small ? " sm" : ""}" role="img" aria-label="Snow grade ${g.letter}, ${g.word}" title="${esc(tip)}">${g.letter}</span>${small ? "" : ` ${g.word}`}`;
}

function bestQuote(win, opts) {
  let best = null;
  for (const [name, [fare, stops]] of Object.entries(win.by_airline)) {
    const al = name.split(", ");
    if (opts.exclude && al.some((a) => opts.exclude.has(a))) continue;
    const bag = opts.bag ? bagFee(al) * 2 : 0;
    if (!best || fare + bag < best.total) best = { name, fare, bag, stops, total: fare + bag };
  }
  return best;
}

function blackout(pass, access, d, r) {
  if (!pass.blackouts.length) return false;
  if (pass.id === "epic_local" && !String(access).includes("holiday")) return false;
  return pass.blackouts.some(([a, b]) => a <= r && b >= d);
}

function accessLabel(a) {
  if (a === "unlimited") return "Unlimited";
  if (typeof a === "number") return `${a} days`;
  return String(a);
}

function render() {
  const opts = { kind: $("kind").value, pass: $("pass").value, origin: $("origin").value, month: $("month").value, shape: $("shape").value,
                 sort: $("sort").value, bag: $("bag").checked, exclude: EXCLUDE };
  try { localStorage.setItem("pf", JSON.stringify(opts)); } catch (e) {}
  const pass = D.passes.find((p) => p.id === opts.pass);
  const origins = opts.origin === "any" ? D.origins : [opts.origin];
  if (opts.kind === "multi" && window.PFClusterUI) return window.PFClusterUI.render(opts, pass, origins);

  const cards = [];
  for (const r of D.resorts) {
    const access = r.access[pass.id];
    if (access == null) continue;
    const options = [];
    for (const o of origins) for (const ap of r.airports) {
      const wins = D.routes[`${o}-${ap.code}`] || {};
      for (const [wk, win] of Object.entries(wins)) {
        const [d, rt] = wk.split("|");
        if (opts.month !== "all" && d.slice(5, 7) !== opts.month) continue;
        if (opts.shape !== "any" && new Date(d + "T12:00:00").getDay() !== (opts.shape === "0" ? 1 : 4)) continue;
        const q = bestQuote(win, opts);
        if (!q) continue;
        const snow = r.snow[wk];
        const score = snow ? snow.score : 50;
        options.push({ o, ap, d, rt, win, q, snow, score, value: score / q.total, blocked: blackout(pass, access, d, rt) });
      }
    }
    const usable = options.filter((x) => !x.blocked);
    if (!usable.length) continue;
    const key = { price: (x) => x.q.total, snow: (x) => -x.score * 10000 + x.q.total, value: (x) => -x.value }[opts.sort];
    usable.sort((a, b) => key(a) - key(b));
    cards.push({ r, access, best: usable[0], top: usable.slice(0, 8), blocked: options.filter((x) => x.blocked) });
  }
  const key = { price: (c) => c.best.q.total, snow: (c) => -c.best.score * 10000 + c.best.q.total, value: (c) => -c.best.value }[opts.sort];
  cards.sort((a, b) => key(a) - key(b));

  $("sort-help").textContent = {
    value: "Best value ranks each mountain's best trip by its historical snow rating divided by the flight + bag cost: more snow per dollar ranks higher. Lodging, lift tickets and drive time aren't included.",
    price: "Cheapest ranks by round-trip flight + bag cost only. Snow isn't considered.",
    snow: "Best snow ranks by the historical snow rating for that week (not a forecast). Price breaks ties.",
  }[opts.sort];
  $("summary").textContent = cards.length
    ? `${cards.length} mountains on the ${pass.name} with flights found${opts.bag ? ", board bag included" : ""}.`
    : "";
    $("cards").innerHTML = cards.length ? cards.map((c) => card(c, pass)).join("")
    : `<div class="empty"><strong>No trips match these filters.</strong>
        <p class="hint">${EXCLUDE.size ? `You're excluding ${EXCLUDE.size} airline${EXCLUDE.size > 1 ? "s" : ""} (${esc([...EXCLUDE].join(", "))}), which can hide flights. ` : ""}Try another month or trip length, or check back later: flight scans rotate through every airport over a few days.</p></div>`;
}

// ---- Single-mountain card (Modern Travel Search, DESIGN_SPEC.md §4) ----
// Presentation only: values, links and ranking come from render() unchanged.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n) => usd.format(n);

// A small "Why?" toggle: a real button that shows its explanation inline (works by tap, click and keyboard).
function toggletip(id, label, text) {
  return `<button type="button" class="tip" aria-expanded="false" aria-controls="${id}">${label}</button><span class="tip-text" id="${id}" hidden>${text}</span>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".tip");
  if (!b) return;
  const t = document.getElementById(b.getAttribute("aria-controls"));
  const open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", open); t.hidden = !open;
});

// "Fare checked 37 h ago" (short form; stale fares are marked, never presented as live)
function fareAgeShort(iso) {
  if (!iso) return "";
  const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z");
  if (isNaN(t)) return "";
  const h = (Date.now() - t) / 36e5;
  const ago = h < 1 ? "under an hour ago" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
  return `<span${h > 96 ? ' class="stale"' : ""}>Fare checked ${ago}${h > 96 ? " (may be out of date)" : ""}</span>`;
}

function card(c, pass) {
  const { r, best: b } = c;
  const id = r.id.replace(/[^a-z0-9-]/gi, "");
  const brand = pass.name.replace(" Pass", "");
  const allowance = c.access === "unlimited" ? "unlimited ski days here"
    : typeof c.access === "number" ? `up to ${c.access} ski days here this season`
    : String(c.access).replace(/^(\d+) days/, "up to $1 ski days");
  const unverified = r.verify && r.verify.includes(pass.id);
  const verify = unverified
    ? `<span class="flag warn">Day limit not verified</span> ${toggletip(`v-${id}`, "Why?", `We list this resort for ${esc(pass.name)} from published 2026-27 pass lists, but haven't confirmed the exact day allowance on the official site. Check ikonpass.com or epicpass.com before relying on it.`)}` : "";

  const lvlText = { low: "below usual", typical: "about usual", high: "above usual" }[b.win.fare_level];
  const lvl = lvlText ? `<span class="chip ${b.win.fare_level}">Fare ${lvlText} for these dates</span>` : "";

  const g = grade(b.snow);
  const snowTip = "Historical, not a forecast: how this week usually looks at this mountain, from 10 past winters (typical base depth plus usual new snow), ranked against every mountain and week we track."
    + (D.enso && r.enso ? ` Adjusted for this winter's ${D.enso.label} using ${r.enso.n} similar past winters.` : "");
  const snow = g
    ? `${gradeBadge(b.snow)} <span class="meta">Usual base ${Math.round(b.snow.depth * 100)} cm</span> ${toggletip(`s-${id}`, "What's this?", esc(snowTip))}`
    : `<span class="meta">Not available yet</span>`;
  const fc = b.snow && b.snow.forecast_fresh != null
    ? `<div class="fc-forecast"><span class="lbl">16-day forecast</span> about ${b.snow.forecast_fresh} cm of new snow around your dates</div>` : "";
  const now = r.season && r.season.depth_m != null && r.season.normal_m
    ? `<p>Snow on the ground now (${fmtDate(r.season.date)}): ${Math.round(r.season.depth_m * 100)} cm · usual for this date: ${Math.round(r.season.normal_m * 100)} cm</p>` : "";
  const enso = r.enso && D.enso
    ? `<p>Past ${esc(D.enso.label)} winters: ${r.enso.raw_pct >= 0 ? "+" : ""}${r.enso.raw_pct}% snow here (Dec–Mar, ${r.enso.n} winters vs all ${r.enso.of} since 1980). The rating uses half of that, capped at ±25%, because the sample is small.</p>` : "";

  const rows = c.top.map((x) => `<tr><td>${fmtDate(x.d)} → ${fmtDate(x.rt)}</td><td>${x.o} → ${x.ap.code}</td>
      <td class="num">${money(x.q.total)}</td><td class="num">${gradeBadge(x.snow, true)}</td>
      <td><a href="${esc(x.win.url)}" target="_blank" rel="noopener" aria-label="Check fares, ${x.o} to ${x.ap.code}, ${fmtDate(x.d)} to ${fmtDate(x.rt)} (opens in a new tab)">Check fares</a></td></tr>`).join("");
  const blockedNote = c.blocked.length
    ? `<p class="note">Not shown: ${c.blocked.length} other date option${c.blocked.length > 1 ? "s" : ""} that overlap ${esc(pass.name)} blackout dates (${[...new Set(c.blocked.map((x) => `${fmtDate(x.d)} → ${fmtDate(x.rt)}`))].slice(0, 4).join("; ")}${c.blocked.length > 4 ? "; …" : ""}).</p>` : "";

  return `<article class="card fc" aria-labelledby="h-${id}">
    <div class="fc-head"><h2 id="h-${id}">${esc(r.name)}</h2><span class="fc-region">${esc(r.region)}</span></div>
    <p class="fc-pass">${esc(brand)}: ${esc(allowance)} ${verify}</p>

    <div class="fc-price">
      <div class="fc-price-label">Estimated round-trip flight${b.q.bag ? " + board bag" : ""}</div>
      <div class="price">${money(b.q.total)}</div>
      <div class="fc-split">${b.q.bag ? `${money(b.q.fare)} base fare + ${money(b.q.bag)} board bag (both ways)` : "Fare only, no board bag"} · ${esc(b.q.name)} · ${b.q.stops ? `${b.q.stops} stop${b.q.stops > 1 ? "s" : ""}` : "nonstop"}</div>
    </div>

    <ul class="fc-trip">
      <li><span class="lbl">Dates</span> ${fmtDate(b.d)} → ${fmtDate(b.rt)}</li>
      <li><span class="lbl">Route</span> ${b.o} → ${b.ap.code}</li>
      <li><span class="lbl">Drive</span> ${b.ap.drive_min} min</li>
    </ul>

    <div class="fc-snow"><span class="lbl">Historical snow this week</span><div class="fc-snow-row">${snow}</div>${fc}</div>

    <p class="fc-fresh">${fareAgeShort(b.win.checked)} ${lvl}</p>
    <p class="fc-excl">Not included: lift tickets, lodging, ground transport.</p>

    <a class="fc-cta" href="${esc(b.win.url)}" target="_blank" rel="noopener">Check fares for these dates on Google Flights <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>

    <details class="fc-more"><summary>More dates, blackout exclusions, and snow details</summary>
      <table><caption class="sr-only">Other date options for ${esc(r.name)}</caption>
        <thead><tr><th scope="col">Dates</th><th scope="col">Route</th><th scope="col" class="num">Flight${b.q.bag ? " + bag" : ""}</th><th scope="col" class="num">Snow</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead><tbody>${rows}</tbody></table>
      ${blockedNote}
      <div class="fc-details">${now}${enso}
        ${lvlText ? `<p>Fare level compares today's cheapest fare for these exact dates with Google's daily lowest fares for the same dates over the past 60 days (all airlines).</p>` : ""}</div>
    </details>
  </article>`;
}
