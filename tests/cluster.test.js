// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const cc = require("../site/cluster-core.js");
const cases = require("./cluster-cases.js");

const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "clusters.json"), "utf8"));
for (const [name, fn] of cases(cc, real)) {
  test(name, () => fn({ equal: (a, b, m) => assert.equal(a, b, m), ok: (v, m) => assert.ok(v, m) }));
}
