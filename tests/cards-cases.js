// Presentation regression cases for site/cards.js (featured + compact single-mountain cards).
// Runs under Node (tests/cards.test.js, in CI) and in the browser (same shim as the other cases).
// These check layout decisions only; ranking, pricing and snow values are passed in as fixtures.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.PFCardsCases = factory;
})(typeof self !== "undefined" ? self : this, function cases(PFCards) {
  "use strict";

  // Minimal formatting helpers with the same contract as cardHelpers() in app.js.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const grade = (s) => (!s ? null : s.score >= 85 ? { letter: "A", word: "Excellent" } : s.score >= 50 ? { letter: "C", word: "Fair" } : { letter: "F", word: "Poor" });
  const H = {
    esc,
    money: (n) => "$" + Math.round(n).toLocaleString("en-US"),
    fmtDate: (d) => d,
    grade,
    gradeBadge: (s, small) => { const g = grade(s); return g ? `<span class="grade" role="img" aria-label="Snow grade ${g.letter}, ${g.word}">${g.letter}</span>${small ? "" : " " + g.word}` : "–"; },
    toggletip: (id, label, text) => `<button type="button" class="tip" aria-expanded="false" aria-controls="${id}">${label}</button><span class="tip-text" id="${id}" hidden>${text}</span>`,
    fareAgeShort: () => "<span>Fare checked 3 h ago</span>",
    enso: null,
    sortLabel: "best value",
  };
  const PASS = { id: "ikon", name: "Ikon Pass" };
  const win = (url, level) => ({ url, checked: "2027-01-02T00:00Z", fare_level: level });
  function mk(id, name, total, opts = {}) {
    const best = {
      o: "LAX", d: "2027-02-15", rt: "2027-02-18",
      ap: { code: opts.code || "RNO", drive_min: opts.drive || 85 },
      q: { total, fare: total - (opts.bag === 0 ? 0 : 90), bag: opts.bag === 0 ? 0 : 90, name: opts.airline || "United", stops: opts.stops || 0 },
      win: win(`https://www.google.com/travel/flights/search?tfs=${id}`, opts.level || "typical"),
      snow: opts.snow === null ? null : { score: opts.snow || 90, depth: 1.53 },
    };
    return {
      r: { id, name, region: "CA", verify: opts.verify ? ["ikon"] : [] },
      access: opts.access || "unlimited",
      best, top: [best], blocked: opts.blocked || [],
    };
  }
  const articles = (html) => html.match(/<article\b[^>]*>/g) || [];
  const resortsOf = (html) => articles(html).map((a) => (a.match(/data-resort="([^"]+)"/) || [])[1]);
  const kindsOf = (html) => articles(html).map((a) => (/\bfeature\b/.test(a) ? "feature" : /\bcompact\b/.test(a) ? "compact" : "?"));

  const list = [];
  const t = (name, fn) => list.push([name, fn]);

  const ranked = [mk("sierra-at-tahoe", "Sierra-at-Tahoe", 263), mk("palisades-tahoe", "Palisades Tahoe", 263), mk("steamboat", "Steamboat", 297, { code: "DEN", drive: 180 })];

  t("featured card is the first result in the given (already ranked) order", (a) => {
    const html = PFCards.list(ranked, PASS, H);
    a.equal(kindsOf(html).join(","), "feature,compact,compact");
    a.equal(resortsOf(html).join(","), "sierra-at-tahoe,palisades-tahoe,steamboat");
  });

  t("changing the order (e.g. another sort or pass) changes the featured resort", (a) => {
    const html = PFCards.list([ranked[2], ranked[0], ranked[1]], PASS, H);
    a.equal(resortsOf(html)[0], "steamboat");
    a.equal(kindsOf(html)[0], "feature");
  });

  t("no resort is duplicated and none is dropped", (a) => {
    const ids = resortsOf(PFCards.list(ranked, PASS, H));
    a.equal(ids.length, ranked.length);
    a.equal(new Set(ids).size, ranked.length);
  });

  t("a single result renders as the featured card only", (a) => {
    a.equal(kindsOf(PFCards.list([ranked[1]], PASS, H)).join(","), "feature");
  });

  t("empty list renders nothing (app.js keeps its own empty state)", (a) => a.equal(PFCards.list([], PASS, H), ""));

  t("photo map: approved resort gets its own locally hosted file", (a) => {
    const p = PFCards.photoFor("sierra-at-tahoe");
    a.ok(p, "has entry");
    a.ok(/^img\/resorts\/sierra-at-tahoe\.[a-z]+$/.test(p.src), "local file named for the resort: " + p.src);
    a.ok(!/^https?:/i.test(p.src), "not hotlinked");
    a.ok(p.width > 0 && p.height > 0, "intrinsic size declared");
    a.ok(/^https:\/\//.test(p.source) && p.credit, "credit and source recorded");
  });

  t("photo map: other resorts and inherited keys get no photo", (a) => {
    for (const id of ["palisades-tahoe", "heavenly", "toString", "__proto__", "constructor", ""]) a.equal(PFCards.photoFor(id), null, id);
  });

  t("featured with approved photo: decorative image, reserved size, credit link", (a) => {
    const html = PFCards.featured(ranked[0], PASS, H);
    a.ok(/class="card fc feature has-photo"/.test(html));
    a.ok(/<img src="img\/resorts\/sierra-at-tahoe\.[a-z]+" alt="" width="\d+" height="\d+"/.test(html), "alt empty + width/height");
    a.ok(/class="ft-credit" href="https:\/\/commons\.wikimedia\.org\/[^"]+" target="_blank" rel="noopener"/.test(html), "credit link");
  });

  t("featured without approved photo falls back to the no-image design", (a) => {
    const html = PFCards.featured(ranked[2], PASS, H);
    a.ok(!/<img\b/.test(html) && !/ft-media/.test(html) && !/ft-credit/.test(html), "no image, no credit");
    a.ok(!/has-photo/.test(html));
    a.ok(/class="card fc feature"/.test(html));
  });

  t("compact cards never carry a photo", (a) => {
    const html = PFCards.compact(ranked[0], PASS, H);
    a.ok(!/<img\b/.test(html) && !/ft-media/.test(html));
  });

  t("price, dates, route, snow, fare age and search link stay visible on both card types", (a) => {
    for (const html of [PFCards.featured(ranked[2], PASS, H), PFCards.compact(ranked[2], PASS, H)]) {
      a.ok(html.includes("$297"), "price");
      a.ok(html.includes("$207 base fare + $90 board bag (both ways)"), "fare + bag split");
      a.ok(html.includes("2027-02-15 → 2027-02-18"), "dates");
      a.ok(/aria-label="Fly LAX to DEN \(nonstop\), then drive about 180 minutes to Steamboat"/.test(html), "route");
      a.ok(html.includes("180 min drive"), "drive");
      a.ok(html.includes('aria-label="Snow grade A, Excellent"'), "snow grade");
      a.ok(/historical/i.test(html), "snow labelled historical");
      a.ok(html.includes("Fare checked"), "fare age");
      a.ok(html.includes('href="https://www.google.com/travel/flights/search?tfs=steamboat"'), "search link");
      a.ok(html.includes("Ikon: unlimited ski days here"), "pass allowance");
      a.ok(html.includes("United"), "airline");
    }
  });

  t("warnings stay visible: unverified day limit, blackout exclusions, fare level", (a) => {
    const c = mk("x", "X", 400, { verify: true, level: "high", access: 5, blocked: [{ d: "2027-02-13", rt: "2027-02-16" }] });
    for (const html of [PFCards.featured(c, PASS, H), PFCards.compact(c, PASS, H)]) {
      a.ok(html.includes("Day limit not verified"), "unverified flag");
      a.ok(html.includes("up to 5 ski days here this season"), "day limit");
      a.ok(html.includes("Not shown: 1 other date option that overlap Ikon Pass blackout dates"), "blackout note");
      a.ok(html.includes("Fare above usual for these dates"), "fare level");
    }
  });

  t("no board bag: price label and split say so", (a) => {
    const c = mk("y", "Y", 180, { bag: 0 });
    const f = PFCards.featured(c, PASS, H), k = PFCards.compact(c, PASS, H);
    a.ok(f.includes("Fare only, no board bag") && k.includes("Fare only, no board bag"));
    a.ok(!/board bag<\/div>/.test(k.replace("Fare only, no board bag", "")), "compact label has no bag");
    a.ok(f.includes("Estimated round-trip flight</div>"), "featured label has no bag");
  });

  t("missing snow data is stated, not hidden", (a) => {
    const c = mk("z", "Z", 300, { snow: null });
    a.ok(PFCards.featured(c, PASS, H).includes("Not available yet"));
    a.ok(PFCards.compact(c, PASS, H).includes("Historical snow: not available yet"));
  });

  t("disclosures are native and keyboard-operable; toggletips reference real ids", (a) => {
    for (const html of [PFCards.featured(ranked[0], PASS, H), PFCards.compact(ranked[0], PASS, H)]) {
      a.ok(/<details class="fc-more"><summary>[^<]+<\/summary>/.test(html), "details/summary");
      const ctl = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
      a.ok(ctl.length > 0, "has toggletip");
      for (const id of ctl) a.ok(html.includes(`id="${id}" hidden`), "target exists: " + id);
    }
  });

  t("flight-search links open in a new tab and say so", (a) => {
    const html = PFCards.list(ranked, PASS, H);
    const links = html.match(/<a [^>]*travel\/flights[^>]*>[\s\S]*?<\/a>/g) || [];
    a.ok(links.length >= 6, "found links");
    for (const l of links) a.ok(/rel="noopener"/.test(l) && /opens in a new tab/.test(l), l.slice(0, 80));
  });

  t("one heading per card, with the resort name", (a) => {
    const html = PFCards.list(ranked, PASS, H);
    a.equal((html.match(/<h2 /g) || []).length, 3);
    a.ok(html.includes('<h2 id="h-steamboat">Steamboat</h2>'));
  });

  t("text from data is escaped", (a) => {
    const c = mk("q", 'A <b>"x"</b>', 300);
    const html = PFCards.featured(c, PASS, H);
    a.ok(!html.includes("<b>") && html.includes("&lt;b&gt;"));
  });

  return list;
});
