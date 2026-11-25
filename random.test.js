const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");

const context = {};
runInNewContext(readFileSync(path.join(__dirname, "shared.js"), "utf8"), context);
const { randomGrade, normalizeSettings } = context.LearnMarks;

test("random grades stay between the minimum and 100, both included", () => {
  assert.equal(randomGrade(85, 100, () => 0), 85);
  assert.equal(randomGrade(85, 100, () => 0.999999), 100);
  assert.equal(randomGrade(84.5, 100, () => 0), 85);
  assert.equal(randomGrade(100, 100, () => 0.5), 100);

  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const grade = randomGrade(85);
    assert.ok(Number.isInteger(grade) && grade >= 85 && grade <= 100, `got ${grade}`);
    seen.add(grade);
  }
  assert.equal(seen.size, 16); // Every value from 85 to 100 shows up.
});

test("the random minimum defaults to 85 and is saved per course", () => {
  assert.equal(normalizeSettings(undefined).randomMin, "85");
  assert.equal(normalizeSettings({ randomMin: "90" }).randomMin, "90");
});
