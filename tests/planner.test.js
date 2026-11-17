// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../site/planner-core.js");
const cases = require("./planner-cases.js");

for (const [name, fn] of cases(core)) {
  test(name, () => fn({ equal: (a, b, m) => assert.equal(a, b, m), ok: (v, m) => assert.ok(v, m) }));
}
