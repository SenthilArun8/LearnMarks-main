const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const shared = readFileSync(path.join(__dirname, "shared.js"), "utf8");
const content = readFileSync(path.join(__dirname, "content.js"), "utf8");
const assignmentsUrl = "https://learn.uwaterloo.ca/d2l/lms/dropbox/user/folders_list.d2l?ou=123&isprv=0";
const gradesUrl = "https://learn.uwaterloo.ca/d2l/lms/grades/my_grades/main.d2l?ou=123";
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

async function open(url, body, storage) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: "outside-only" });
  const changeListeners = [];
  const messageListeners = [];
  dom.window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([keys].flat().map((k) => [k, storage[k]])),
        set: async (values) => {
          Object.assign(storage, values);
          const changes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }]));
          for (const listener of changeListeners) listener(changes, "local");
        },
      },
      onChanged: { addListener: (listener) => changeListeners.push(listener) },
    },
    runtime: { onMessage: { addListener: (listener) => messageListeners.push(listener) } },
  };
  dom.window.eval(shared);
  dom.window.eval(content);
  await flush();
  return {
    text: (id, index) => dom.window.document.getElementById(id).cells[index].textContent.trim(),
    rows() {
      let response;
      messageListeners[0]({ type: "learnmarks:getRows" }, {}, (value) => (response = value));
      return JSON.parse(JSON.stringify(response.rows));
    },
  };
}

const assignments = `
  <table>
    <tr><th>Assignment</th><th>Completion Status</th><th>Score</th><th>Evaluation Status</th><th>Due Date</th></tr>
    <tr id="a3"><th>Assignment 3</th><td>1 Submission, 1 File</td><td>30 / 40 - 75 %</td><td>Feedback: Read</td><td></td></tr>
    <tr id="a4"><th>Assignment  4</th><td>Not Submitted</td><td>- / 40</td><td></td><td>Dec 1, 2026</td></tr>
  </table>`;

const grades = `
  <table>
    <tr><th>Grade Item</th><th>Points</th><th>Grade</th><th>Comments and Assessments</th></tr>
    <tr id="a3"><th>Assignment 3</th><td>30 / 40</td><td>75 %</td><td>Q1: 9/10 - Missing labels.</td></tr>
    <tr id="a4"><th>Assignment 4</th><td>0 / 40</td><td>0 %</td><td></td></tr>
    <tr id="a5"><th>Assignment 5</th><td>- / 40</td><td>-</td><td></td></tr>
  </table>`;

test("the Assignments page marks unsubmitted work and gives it no marks", async () => {
  const storage = {};
  const page = await open(assignmentsUrl, assignments, storage);
  assert.equal(page.text("a3", 2), "40 / 40 - 100 %");
  assert.equal(page.text("a4", 2), "- / 40");
  assert.deepEqual(JSON.parse(JSON.stringify(storage["submissions:123"])), { notSubmitted: ["assignment 4"] });
  assert.deepEqual(
    page.rows().map((row) => [row.name, row.skip]),
    [
      ["Assignment 3", null],
      ["Assignment  4", "not submitted"],
    ]
  );
});

test("the Grades page skips what the Assignments page said wasn't submitted", async () => {
  const storage = { "submissions:123": { notSubmitted: ["assignment 4"] } };
  const page = await open(gradesUrl, grades, storage);
  assert.equal(page.text("a3", 1), "40 / 40");
  assert.equal(page.text("a3", 3), "Q1: 10/10");
  // Not submitted: the default doesn't turn 0 / 40 into 40 / 40.
  assert.equal(page.text("a4", 1), "0 / 40");
  assert.equal(page.text("a4", 2), "0 %");
  assert.deepEqual(
    page.rows().map((row) => [row.name, row.skip]),
    [
      ["Assignment 3", null],
      ["Assignment 4", "not submitted"],
      ["Assignment 5", "not graded"],
    ]
  );
});

test("a grade typed for an unsubmitted row still applies", async () => {
  const storage = {
    "submissions:123": { notSubmitted: ["assignment 4"] },
    "course:123": { rows: { "Assignment 4": { grade: "90" } } },
  };
  const page = await open(gradesUrl, grades, storage);
  assert.equal(page.text("a4", 1), "36 / 40");
  assert.equal(page.text("a4", 2), "90 %");
});
