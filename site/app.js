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
  // "any" = every published origin; per-airport choices only when there is more than one.
  $("origin").innerHTML = `<option value="any">${D.origins.join(" or ")}</option>`
    + (D.origins.length > 1 ? D.origins.map((o) => `<option value="${o}">${o} only</option>`).join("") : "");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("pf") || "{}"); for (const k in saved) if ($(k)) $(k)[typeof saved[k] === "boolean" ? "checked" : "value"] = saved[k]; } catch (e) {}
  if (!$("origin").value) $("origin").value = "any"; // a saved airport that is no longer published
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
  $("scope-note").hidden = true; // single-mountain scope note; re-shown below when single results exist
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
  $("scope-note").hidden = !cards.length;
  $("cards").innerHTML = cards.length ? PFCards.list(cards, pass, cardHelpers(opts))
    : `<div class="empty"><strong>No trips match these filters.</strong>
        <p class="hint">${EXCLUDE.size ? `You're excluding ${EXCLUDE.size} airline${EXCLUDE.size > 1 ? "s" : ""} (${esc([...EXCLUDE].join(", "))}), which can hide flights. ` : ""}Try another month or trip length, or check back later: flight scans rotate through every airport over a few days.</p></div>`;
}

// ---- Single-mountain cards (Modern Travel Search, DESIGN_SPEC.md §4): markup lives in cards.js ----
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

// Formatting helpers handed to the card templates in cards.js (layout only; values come from render()).
const SORT_LABEL = { price: "cheapest", snow: "best snow", value: "best value" }; // matches the Sort menu wording
function cardHelpers(opts) {
  return { esc, money, fmtDate, grade, gradeBadge, toggletip, fareAgeShort, enso: D.enso, sortLabel: SORT_LABEL[opts.sort] || opts.sort };
}
