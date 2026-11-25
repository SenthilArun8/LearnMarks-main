const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");

const context = {};
runInNewContext(readFileSync(path.join(__dirname, "shared.js"), "utf8"), context);
const { backupEntries } = context.LearnMarks;
const plain = (value) => JSON.parse(JSON.stringify(value));

const stored = {
  "course:1293839": {
    enabled: true,
    matchFeedback: true,
    defaultGrade: "100",
    randomMin: "85",
    rows: { "Assignment 1": { grade: "92", comment: "Q1: 4/4" } },
  },
  "submissions:1293839": { notSubmitted: ["assignment 4"] },
};

test("an exported backup imports back to the same settings", () => {
  const file = JSON.parse(JSON.stringify({ app: "perfect-grade-display", version: 1, data: backupEntries(stored) }));
  assert.deepEqual(plain(backupEntries(file)), stored);
});

test("imports keep only the extension's own, well-formed entries", () => {
  const entries = backupEntries({
    "course:1": { rows: { A: { grade: 5, comment: "ok" }, B: "bad" } },
    "submissions:1": { notSubmitted: ["a", 3] },
    "other-key": { anything: true },
    "course:2": "not an object",
  });
  assert.deepEqual(plain(entries), {
    "course:1": {
      enabled: true,
      matchFeedback: true,
      defaultGrade: "100",
      randomMin: "85",
      rows: { A: { grade: "", comment: "ok" } },
    },
    "submissions:1": { notSubmitted: ["a"] },
  });
});

test("files that aren't backups are rejected", () => {
  assert.equal(backupEntries(null), null);
  assert.equal(backupEntries([1, 2]), null);
  assert.equal(backupEntries({ hello: "world" }), null);
});
