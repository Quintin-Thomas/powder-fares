"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
let D;

fetch("data.json").then((r) => r.json()).then((data) => {
  D = data;
  $("pass").innerHTML = D.passes.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("origin").innerHTML += D.origins.map((o) => `<option value="${o}">${o} only</option>`).join("");
  try { const saved = JSON.parse(localStorage.getItem("pf") || "{}"); for (const k in saved) if ($(k)) $(k)[typeof saved[k] === "boolean" ? "checked" : "value"] = saved[k]; } catch (e) {}
  document.querySelectorAll("select,input").forEach((el) => el.addEventListener("change", render));
  $("updated").textContent = `Prices and snow updated ${new Date(D.generated).toLocaleString()}.`;
  render();
});

function bagFee(airlines) {
  return Math.max(...airlines.map((a) => D.airlines.fees[a] ?? D.airlines.default_fee));
}

function bestQuote(win, opts) {
  let best = null;
  for (const [name, [fare, stops]] of Object.entries(win.by_airline)) {
    const al = name.split(", ");
    if (opts.nofrontier && al.includes("Frontier")) continue;
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
                 sort: $("sort").value, bag: $("bag").checked, nofrontier: $("nofrontier").checked };
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
    cards.push({ r, access, best: usable[0], top: usable.slice(0, 8), blockedCount: options.length - usable.length });
  }
  const key = { price: (c) => c.best.q.total, snow: (c) => -c.best.score * 10000 + c.best.q.total, value: (c) => -c.best.value }[opts.sort];
  cards.sort((a, b) => key(a) - key(b));

  $("summary").textContent = cards.length
    ? `${cards.length} mountains on the ${pass.name} with flights found${opts.bag ? ", board bag included" : ""}.`
    : "";
  $("cards").innerHTML = cards.length ? cards.map((c) => card(c, pass)).join("")
    : `<p class="empty">No flights scanned yet for this filter. Scans rotate through every airport over a few days.</p>`;
}

function card(c, pass) {
  const { r, best: b } = c;
  const lvl = b.win.fare_level ? `<span class="chip ${b.win.fare_level}">fares ${b.win.fare_level} vs 60 days</span>` : "";
  const fc = b.snow && b.snow.forecast_fresh != null ? `<span class="chip">forecast ${b.snow.forecast_fresh} cm new</span>` : "";
  const season = r.season && r.season.depth_m != null && r.season.normal_m
    ? `<span class="chip ${r.season.depth_m < r.season.normal_m * 0.7 ? "warn" : ""}">base now ${Math.round(r.season.depth_m * 100)} cm (normal ${Math.round(r.season.normal_m * 100)})</span>` : "";
  const verify = r.verify && r.verify.includes(pass.id) ? `<span class="chip warn">access unconfirmed</span>` : "";
  const rows = c.top.map((x) => `<tr><td>${fmtDate(x.d)} → ${fmtDate(x.rt)}</td><td>${x.o}→${x.ap.code}</td>
      <td class="num">$${x.q.total}</td><td class="num">${x.snow ? x.snow.score : "–"}</td>
      <td><a href="${esc(x.win.url)}" target="_blank" rel="noopener">Google</a></td></tr>`).join("");
  return `<article class="card">
    <div class="row"><h2>${esc(r.name)}</h2><span class="meta">${esc(r.region)}</span></div>
    <div class="meta">${esc(accessLabel(c.access))} on ${esc(pass.name)} · fly ${b.o}→${b.ap.code}, ${b.ap.drive_min} min drive ${verify}</div>
    <div class="row"><span class="price">$${b.q.total}</span>
      <span class="break">${b.q.bag ? `$${b.q.fare} fare + $${b.q.bag} board bag` : `fare`} · ${esc(b.q.name)}${b.q.stops ? `, ${b.q.stops} stop` : ", nonstop"}</span></div>
    <div class="meta">${fmtDate(b.d)} → ${fmtDate(b.rt)} ${lvl}</div>
    <div class="row meta"><span>Snow score ${b.snow ? b.snow.score : "–"}/100${b.snow ? ` · usual base ${Math.round(b.snow.depth * 100)} cm` : ""}</span>${fc}</div>
    <div class="snowbar"><span style="width:${b.snow ? b.snow.score : 0}%"></span></div>
    <div>${season}${c.blockedCount ? `<span class="chip warn">${c.blockedCount} dates hit pass blackouts</span>` : ""}</div>
    <details><summary>More dates</summary>
      <table><thead><tr><th>Dates</th><th>Route</th><th class="num">Total</th><th class="num">Snow</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </details>
    <a href="${esc(b.win.url)}" target="_blank" rel="noopener">See this flight on Google Flights →</a>
  </article>`;
}
