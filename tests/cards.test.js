// Run with: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const PFCards = require("../site/cards.js");
const photos = require("../site/photos.js");
const cases = require("./cards-cases.js");

for (const [name, fn] of cases(PFCards)) {
  test(name, () => fn({ equal: (a, b, m) => assert.equal(a, b, m), ok: (v, m) => assert.ok(v, m) }));
}

// Node-only checks: files on disk and stylesheet rules.
const site = path.join(__dirname, "..", "site");

// Reads width/height from a baseline or progressive JPEG (SOF0/SOF2 marker).
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xc0 || m === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test("every approved photo exists locally, matches its declared size and stays small", () => {
  for (const [id, p] of Object.entries(photos)) {
    const file = path.join(site, p.src);
    assert.ok(fs.existsSync(file), `${id}: ${p.src} missing`);
    const buf = fs.readFileSync(file);
    assert.ok(buf.length < 150 * 1024, `${id}: ${buf.length} bytes (keep under 150 KB)`);
    const dim = jpegSize(buf);
    assert.deepEqual(dim, { width: p.width, height: p.height }, id);
  }
});

test("every approved photo has a licensing record in docs/IMAGE_CREDITS.md", () => {
  const credits = fs.readFileSync(path.join(__dirname, "..", "docs", "IMAGE_CREDITS.md"), "utf8");
  for (const [id, p] of Object.entries(photos)) {
    assert.ok(credits.includes(p.src), `${id}: no record for ${p.src}`);
    assert.ok(credits.includes(p.source), `${id}: source URL not recorded`);
  }
});

test("photo treatment: fixed height, fade to the card, theme-specific dark filter only", () => {
  const css = fs.readFileSync(path.join(site, "style.css"), "utf8");
  assert.match(css, /\.ft-media \{ height: \d+px;/, "reserved height");
  assert.match(css, /\.ft-media::after \{[^}]*linear-gradient\(180deg, transparent \d+%, var\(--card\) 100%\)/, "fade into card");
  assert.match(css, /prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \.ft-media img \{ filter: brightness\(0?\.9\d*\)/, "dark-mode lift");
  const light = css.replace(/@media \(prefers-color-scheme: dark\)[^\n]*\n?/g, "");
  assert.doesNotMatch(light.match(/\.ft-media img \{[^}]*\}/)[0], /filter/, "no filter in light mode");
});
