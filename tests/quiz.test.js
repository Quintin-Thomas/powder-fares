// Run with: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../site/planner-core.js");
const qc = require("../site/quiz-core.js");
const cases = require("./quiz-cases.js");

for (const [name, fn] of cases(qc, core)) {
  test(name, () => fn({ equal: (a, b, m) => assert.equal(a, b, m), ok: (v, m) => assert.ok(v, m) }));
}
