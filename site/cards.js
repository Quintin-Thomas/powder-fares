// Single-mountain result cards (presentation only). Shared by the website (window.PFCards) and the
// tests (Node: require()). Pure string templates: no DOM, no network, no ranking or pricing.
// render() in app.js decides which mountains appear and in what order; list() only lays them out:
// the first result becomes the featured card, every other result a compact card. Nothing is repeated.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./photos.js"));
  else root.PFCards = factory(root.PFPhotos || {});
})(typeof self !== "undefined" ? self : this, function (PHOTOS) {
  "use strict";

  // Photo for a resort id, or null. Own-property lookup only: no fallbacks to another resort.
  function photoFor(id) {
    return Object.prototype.hasOwnProperty.call(PHOTOS, id) ? PHOTOS[id] : null;
  }

  // h = { esc, money, fmtDate, grade, gradeBadge, toggletip, fareAgeShort, enso, sortLabel }
  function parts(c, pass, h) {
    const { esc, money, fmtDate } = h;
    const { r, best: b } = c;
    const id = r.id.replace(/[^a-z0-9-]/gi, "");
    const brand = pass.name.replace(" Pass", "");
    const allowance = c.access === "unlimited" ? "unlimited ski days here"
      : typeof c.access === "number" ? `up to ${c.access} ski days here this season`
      : String(c.access).replace(/^(\d+) days/, "up to $1 ski days");
    const unverified = r.verify && r.verify.includes(pass.id);
    const verify = unverified
      ? `<span class="flag warn">Day limit not verified</span> ${h.toggletip(`v-${id}`, "Why?", `We list this resort for ${esc(pass.name)} from published 2026-27 pass lists, but haven't confirmed the exact day allowance on the official site. Check ikonpass.com or epicpass.com before relying on it.`)}` : "";
    const lvlText = { low: "below usual", typical: "about usual", high: "above usual" }[b.win.fare_level];
    const lvl = lvlText ? `<span class="chip ${b.win.fare_level}">Fare ${lvlText} for these dates</span>` : "";
    const g = h.grade(b.snow);
    const snowTip = "Historical, not a forecast: how this week usually looks at this mountain, from 10 past winters (typical base depth plus usual new snow), ranked against every mountain and week we track."
      + (h.enso && r.enso ? ` Adjusted for this winter's ${h.enso.label} using ${r.enso.n} similar past winters.` : "");
    const tip = h.toggletip(`s-${id}`, "What's this?", esc(snowTip));
    const base = g ? `<span class="nw">usual base ${Math.round(b.snow.depth * 100)} cm</span>` : "";
    const fc = b.snow && b.snow.forecast_fresh != null
      ? `<p class="fc-forecast"><span class="lbl">16-day forecast</span> about ${b.snow.forecast_fresh} cm of new snow around your dates</p>` : "";
    const now = r.season && r.season.depth_m != null && r.season.normal_m
      ? `<p>Snow on the ground now (${fmtDate(r.season.date)}): ${Math.round(r.season.depth_m * 100)} cm · usual for this date: ${Math.round(r.season.normal_m * 100)} cm</p>` : "";
    const enso = r.enso && h.enso
      ? `<p>Past ${esc(h.enso.label)} winters: ${r.enso.raw_pct >= 0 ? "+" : ""}${r.enso.raw_pct}% snow here (Dec–Mar, ${r.enso.n} winters vs all ${r.enso.of} since 1980). The rating uses half of that, capped at ±25%, because the sample is small.</p>` : "";
    const rows = c.top.map((x) => `<tr><td>${fmtDate(x.d)} → ${fmtDate(x.rt)}</td><td>${x.o} → ${x.ap.code}</td>
        <td class="num">${money(x.q.total)}</td><td class="num">${h.gradeBadge(x.snow, true)}</td>
        <td><a href="${esc(x.win.url)}" target="_blank" rel="noopener" aria-label="Check fares, ${x.o} to ${x.ap.code}, ${fmtDate(x.d)} to ${fmtDate(x.rt)} (opens in a new tab)">Check fares</a></td></tr>`).join("");
    const blockedNote = c.blocked.length
      ? `<p class="note">Not shown: ${c.blocked.length} other date option${c.blocked.length > 1 ? "s" : ""} that overlap ${esc(pass.name)} blackout dates (${[...new Set(c.blocked.map((x) => `${fmtDate(x.d)} → ${fmtDate(x.rt)}`))].slice(0, 4).join("; ")}${c.blocked.length > 4 ? "; …" : ""}).</p>` : "";
    const more = (label) => `<details class="fc-more"><summary>${label}</summary>
        <table><caption class="sr-only">Other date options for ${esc(r.name)}</caption>
          <thead><tr><th scope="col">Dates</th><th scope="col">Route</th><th scope="col" class="num">Flight${b.q.bag ? " + bag" : ""}</th><th scope="col" class="num">Snow</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead><tbody>${rows}</tbody></table>
        ${blockedNote}
        <div class="fc-details">${now}${enso}
          ${lvlText ? `<p>Fare level compares today's cheapest fare for these exact dates with Google's daily lowest fares for the same dates over the past 60 days (all airlines).</p>` : ""}</div>
      </details>`;
    const stops = b.q.stops ? `${b.q.stops} stop${b.q.stops > 1 ? "s" : ""}` : "nonstop";
    const fare = b.q.bag ? `${money(b.q.fare)} base fare + ${money(b.q.bag)} board bag (both ways)` : "Fare only, no board bag";
    const dates = `${fmtDate(b.d)} → ${fmtDate(b.rt)}`;
    // Route progression: origin → arrival airport → drive → mountain. Real codes and drive minutes only.
    const route = `<div class="route" role="img" aria-label="Fly ${b.o} to ${b.ap.code} (${stops}), then drive about ${b.ap.drive_min} minutes to ${esc(r.name)}">
        <span class="stop"><span class="code">${b.o}</span></span>
        <span class="leg fly" aria-hidden="true"><span class="leg-txt">${stops}</span></span>
        <span class="stop"><span class="code">${b.ap.code}</span></span>
        <span class="leg drive" aria-hidden="true"><span class="leg-txt">${b.ap.drive_min} min drive</span></span>
        <span class="stop end"><span class="code mtn"><span class="mk" aria-hidden="true">▲</span><span class="nm">${esc(r.name)}</span></span></span>
      </div>`;
    return { r, b, id, brand, allowance, verify, lvl, g, tip, base, fc, more, fare, stops, dates, route };
  }

  function featured(c, pass, h) {
    const { esc, money } = h;
    const p = parts(c, pass, h);
    const photo = photoFor(p.r.id);
    const media = photo
      ? `<div class="ft-media"><img src="${esc(photo.src)}" alt="" width="${photo.width}" height="${photo.height}" decoding="async" fetchpriority="high" style="object-position:${esc(photo.position)}"></div>` : "";
    const credit = photo
      ? `<a class="ft-credit" href="${esc(photo.source)}" target="_blank" rel="noopener">${esc(photo.credit)}<span class="sr-only"> (photo source, opens in a new tab)</span></a>` : "";
    const snow = p.g
      ? `${h.gradeBadge(p.b.snow)} <span class="muted">${p.base}</span> ${p.tip}`
      : `<span class="muted">Not available yet</span>`;
    return `<article class="card fc feature${photo ? " has-photo" : ""}" aria-labelledby="h-${p.id}" data-resort="${esc(p.r.id)}">
      ${media}
      <div class="ft-body">
        <div class="ft-main">
          <p class="ft-eyebrow"><span>Top result · sorted by ${esc(h.sortLabel)}</span>${credit}</p>
          <div class="ft-title"><h2 id="h-${p.id}">${esc(p.r.name)}</h2><span class="fc-region">${esc(p.r.region)}</span></div>
          <p class="fc-pass">${esc(p.brand)}: ${esc(p.allowance)} ${p.verify}</p>
          ${p.route}
          <div class="ft-facts">
            <div><span class="ft-k">Dates</span><span class="ft-v">${p.dates}</span></div>
            <div><span class="ft-k">Historical snow this week</span><span class="ft-v ft-snow">${snow}</span></div>
          </div>
          ${p.fc}
          ${p.more("More dates, blackout exclusions, and snow details")}
        </div>
        <div class="ft-price">
          <div class="fc-price-label">Estimated round-trip flight${p.b.q.bag ? " + board bag" : ""}</div>
          <div class="price">${money(p.b.q.total)}</div>
          <div class="fc-split">${p.fare} · ${esc(p.b.q.name)} · ${p.stops}</div>
          <p class="fc-fresh">${h.fareAgeShort(p.b.win.checked)} ${p.lvl}</p>
          <a class="fc-cta" href="${esc(p.b.win.url)}" target="_blank" rel="noopener">Check fares for these dates on Google Flights <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>
          <p class="fc-excl">Not included: lift tickets, lodging, ground transport.</p>
        </div>
      </div>
    </article>`;
  }

  function compact(c, pass, h) {
    const { esc, money } = h;
    const p = parts(c, pass, h);
    const snow = p.g
      ? `${h.gradeBadge(p.b.snow)} <span class="muted">historical snow · ${p.base}</span> ${p.tip}`
      : `<span class="muted">Historical snow: not available yet</span>`;
    return `<article class="card fc compact" aria-labelledby="h-${p.id}" data-resort="${esc(p.r.id)}">
      <div class="cp-head">
        <div class="cp-id"><h2 id="h-${p.id}">${esc(p.r.name)}</h2>
          <p class="cp-sub">${esc(p.r.region)} · ${esc(p.brand)}: ${esc(p.allowance)} ${p.verify}</p></div>
        <div class="cp-price"><div class="price">${money(p.b.q.total)}</div><div class="cp-pl">Est. round-trip flight${p.b.q.bag ? " + board bag" : ""}</div></div>
      </div>
      ${p.route}
      <p class="cp-when">${p.dates}</p>
      <p class="cp-snow">${snow}</p>
      ${p.fc}
      <p class="cp-meta">${p.fare} · ${esc(p.b.q.name)}<br>${h.fareAgeShort(p.b.win.checked)} ${p.lvl}</p>
      <div class="cp-actions"><a class="fc-cta" href="${esc(p.b.win.url)}" target="_blank" rel="noopener" aria-label="Check fares on Google Flights, ${p.b.o} to ${p.b.ap.code}, ${p.dates} (opens in a new tab)">Check fares <span aria-hidden="true">↗</span></a>${p.more("More dates and details")}</div>
    </article>`;
  }

  // Lay out an already-ranked list. Order and membership are exactly the input's.
  function list(cards, pass, h) {
    return cards.map((c, i) => (i === 0 ? featured(c, pass, h) : compact(c, pass, h))).join("");
  }

  return { photoFor, featured, compact, list };
});
