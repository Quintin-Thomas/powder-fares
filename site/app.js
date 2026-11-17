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
      $("cards").innerHTML = `<div class="error"><strong>Couldn't load trip data.</strong> ${esc(e.message)}. Check your connection and <button class="btn" id="retry">Try again</button></div>`;
      $("retry").addEventListener("click", loadData);
    });
}
loadData();

function start(data) {
  D = data;
  $("pass").innerHTML = D.passes.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("origin").innerHTML += D.origins.map((o) => `<option value="${o}">${o} only</option>`).join("");
  try { const saved = JSON.parse(localStorage.getItem("pf") || "{}"); for (const k in saved) if ($(k)) $(k)[typeof saved[k] === "boolean" ? "checked" : "value"] = saved[k]; } catch (e) {}
  setupAirlines();
  document.querySelectorAll(".controls select, .controls > label input").forEach((el) => el.addEventListener("change", render));
  $("updated").textContent = `Prices and snow updated ${new Date(D.generated).toLocaleString()}.`;
  if (D.enso && D.enso.analogs && D.enso.analogs.length) {
    const yrs = D.enso.analogs.map((y) => `${y}–${String(y + 1).slice(2)}`).join(", ");
    $("enso").innerHTML = `<strong>This winter: ${esc(D.enso.label)}.</strong> ${esc(D.enso.summary)} Historical snow ratings lean on how each mountain did in the ${D.enso.analogs.length} most similar past winters (${yrs}), compared with all winters since 1980. <a href="${esc(D.enso.source)}" target="_blank" rel="noopener">NOAA outlook</a>`;
    $("enso").hidden = false;
  }
  render();
  window.PF = { D, bestQuote, fmtDate, esc, opts: () => ({ bag: $("bag").checked, exclude: EXCLUDE }) };
  document.dispatchEvent(new Event("pf-ready"));
}

function bagFee(airlines) {
  return Math.max(...airlines.map((a) => D.airlines.fees[a] ?? D.airlines.default_fee));
}

// ---- Exclude-airlines picker ----
let EXCLUDE = new Set();
function setupAirlines() {
  const all = new Set();
  for (const wins of Object.values(D.routes)) for (const w of Object.values(wins))
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
  if (!g) return `<span class="grade">–</span>`;
  const tip = `${g.word}: better than ${snow.score}% of mountain-weeks we track. Based on the usual base depth and fresh snow that week${snow.forecast_fresh != null ? " plus the 16-day forecast" : ""}.`;
  return `<span class="grade g-${g.letter}${small ? " sm" : ""}" title="${esc(tip)}">${g.letter}</span>${small ? "" : ` ${g.word}`}`;
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
  const opts = { pass: $("pass").value, origin: $("origin").value, month: $("month").value, shape: $("shape").value,
                 sort: $("sort").value, bag: $("bag").checked, exclude: EXCLUDE };
  try { localStorage.setItem("pf", JSON.stringify(opts)); } catch (e) {}
  const pass = D.passes.find((p) => p.id === opts.pass);
  const origins = opts.origin === "any" ? D.origins : [opts.origin];

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
    : `<p class="empty">No flights scanned yet for this filter. Scans rotate through every airport over a few days.</p>`;
}

function card(c, pass) {
  const { r, best: b } = c;
  const brand = pass.name.replace(" Pass", "");
  // Pass entitlement, worded so it can't be confused with trip length.
  const allowance = c.access === "unlimited" ? "unlimited ski days here"
    : typeof c.access === "number" ? `up to ${c.access} ski days here this season`
    : String(c.access).replace(/^(\d+) days/, "up to $1 ski days");
  const verify = r.verify && r.verify.includes(pass.id)
    ? ` <span class="chip info" title="We list this resort for ${esc(pass.name)} from published 2026-27 pass lists, but haven't confirmed the exact day allowance on the official site. Check ikonpass.com or epicpass.com before relying on it.">day limit not yet verified</span>` : "";

  // Fare: what it includes, how fresh it is, and how it compares with recent prices for the same dates.
  const lvlText = { low: "lower than usual", typical: "about usual", high: "higher than usual" }[b.win.fare_level];
  const lvl = lvlText ? `<span class="chip ${b.win.fare_level}" title="Today's cheapest fare for these exact dates compared with Google's daily lowest fares for the same dates over the past 60 days (all airlines).">fare ${lvlText} for these dates</span>` : "";
  const checked = fareAge(b.win.checked);

  // Snow: historical tendency, today's snowpack, and a real forecast only when one exists.
  const g = grade(b.snow);
  const snowTip = "Historical, not a forecast: how this week usually looks at this mountain, from 10 past winters (typical base depth plus usual new snow), ranked against every mountain and week we track."
    + (D.enso && r.enso ? ` Adjusted for this winter's ${D.enso.label} using ${r.enso.n} similar past winters.` : "");
  const histSnow = g
    ? `<div class="line"><span class="lbl">Historical snow, this week</span> ${gradeBadge(b.snow)} <span class="meta">usual base ${Math.round(b.snow.depth * 100)} cm</span> <span class="info-i" title="${esc(snowTip)}">ⓘ</span></div>`
    : `<div class="line"><span class="lbl">Historical snow, this week</span> <span class="meta">not available yet</span></div>`;
  const fc = b.snow && b.snow.forecast_fresh != null
    ? `<div class="line"><span class="lbl">Forecast (16-day)</span> about ${b.snow.forecast_fresh} cm of new snow around your dates</div>` : "";
  const now = r.season && r.season.depth_m != null && r.season.normal_m
    ? `<div class="line meta">Snow on the ground now (${fmtDate(r.season.date)}): ${Math.round(r.season.depth_m * 100)} cm · usual for this date: ${Math.round(r.season.normal_m * 100)} cm</div>` : "";
  const ensoChip = r.enso && D.enso
    ? `<span class="chip ${r.enso.pct >= 3 ? "low" : r.enso.pct <= -3 ? "warn" : ""}" title="Dec–Mar snowfall in ${r.enso.n} past ${esc(D.enso.label)} winters vs all ${r.enso.of} winters since 1980: ${r.enso.raw_pct >= 0 ? "+" : ""}${r.enso.raw_pct}%. The rating uses half of that (capped at ±25%) because the sample is small.">past ${esc(D.enso.label)} winters: ${r.enso.raw_pct >= 0 ? "+" : ""}${r.enso.raw_pct}% snow</span>` : "";

  const rows = c.top.map((x) => `<tr><td>${fmtDate(x.d)} → ${fmtDate(x.rt)}</td><td>${x.o}→${x.ap.code}</td>
      <td class="num">$${x.q.total}</td><td class="num">${gradeBadge(x.snow, true)}</td>
      <td><a href="${esc(x.win.url)}" target="_blank" rel="noopener">Check fares</a></td></tr>`).join("");
  const blockedNote = c.blocked.length
    ? `<p class="note">Not shown: ${c.blocked.length} other date option${c.blocked.length > 1 ? "s" : ""} that overlap ${esc(pass.name)} blackout dates (${[...new Set(c.blocked.map((x) => `${fmtDate(x.d)} → ${fmtDate(x.rt)}`))].slice(0, 4).join("; ")}${c.blocked.length > 4 ? "; …" : ""}).</p>` : "";

  return `<article class="card">
    <div class="row"><h2>${esc(r.name)}</h2><span class="meta">${esc(r.region)}</span></div>
    <div class="meta">${esc(brand)}: ${esc(allowance)}${verify}</div>
    <div class="row"><span class="price">$${b.q.total}</span>
      <span class="break">${b.q.bag ? `$${b.q.fare} fare + $${b.q.bag} board bag (both ways)` : "fare only"} · ${esc(b.q.name)}${b.q.stops ? `, ${b.q.stops} stop` : ", nonstop"}</span></div>
    <div class="meta">Round-trip flight${b.q.bag ? " + board bag" : ""}, estimated. ${checked}</div>
    <div class="line"><strong>${fmtDate(b.d)} → ${fmtDate(b.rt)}</strong> · ${b.o}→${b.ap.code}, then ${b.ap.drive_min} min drive ${lvl}</div>
    ${histSnow}${fc}${now}
    ${ensoChip ? `<div>${ensoChip}</div>` : ""}
    <details><summary>More dates${c.blocked.length ? " and blackout info" : ""}</summary>
      <table><thead><tr><th>Dates</th><th>Route</th><th class="num">Flight + bag</th><th class="num">Snow</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${blockedNote}
    </details>
    <a href="${esc(b.win.url)}" target="_blank" rel="noopener">Check current fares for these dates on Google Flights →</a>
  </article>`;
}

// "Fare checked 3 h ago" from the per-itinerary scan time (stored in UTC).
function fareAge(iso) {
  if (!iso) return "";
  const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z");
  if (isNaN(t)) return "";
  const h = (Date.now() - t) / 36e5;
  const ago = h < 1 ? "under an hour ago" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
  const when = new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<span title="This fare was last searched ${when} (your time). Prices change; check before booking."${h > 96 ? ' class="stale"' : ""}>Fare checked ${ago}${h > 96 ? " (may be out of date)" : ""}.</span> Not included: lift tickets, lodging, ground transport.`;
}
