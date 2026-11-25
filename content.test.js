const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const shared = readFileSync(path.join(__dirname, "shared.js"), "utf8");
const content = readFileSync(path.join(__dirname, "content.js"), "utf8");
const gradesUrl = "https://learn.uwaterloo.ca/d2l/lms/grades/my_grades/main.d2l?ou=123";

const table = `
  <table class="d2l-table">
    <tr>
      <th colspan="2">Grade Item</th><th>Points</th><th>Weight Achieved</th>
      <th>Grade</th><th>Comments and Assessments</th>
    </tr>
    <tr id="final">
      <th colspan="2"><strong>Final Calculated Grade</strong></th><td></td>
      <td>78.5 / 100</td><td>78.5 %</td><td></td>
    </tr>
    <tr id="cat">
      <th colspan="2"><strong>Assignments</strong></th><td></td>
      <td>17 / 20</td><td>85 %</td><td></td>
    </tr>
    <tr id="a1">
      <td></td><th><label>Assignment 1</label><div>Due Monday</div></th>
      <td><label>8.5</label> / <label>10</label></td>
      <td>4.25 / 5</td><td>85 %</td>
      <td><div>Feedback: lost marks on Q2</div><div>Rubric 3 / 4</div></td>
    </tr>
  </table>`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

async function run(url, body, stored = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: "outside-only" });
  const storage = { ...stored };
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
  const $ = (selector) => dom.window.document.querySelector(selector);
  return {
    $,
    cell: (row, index) => $(`#${row}`).cells[index].textContent.replace(/\s+/g, " ").trim(),
    async setSettings(value) {
      const key = "course:123";
      storage[key] = value;
      for (const listener of changeListeners) listener({ [key]: { newValue: value } }, "local");
      await flush();
    },
    getRows() {
      let response;
      for (const listener of messageListeners) {
        listener({ type: "learnmarks:getRows" }, {}, (value) => (response = value));
      }
      return response;
    },
    window: dom.window,
    storage,
    hasListeners: () => messageListeners.length > 0,
  };
}

test("changes points, weight, grade and comment scores to full marks by default", async () => {
  const page = await run(gradesUrl, table);
  assert.equal(page.cell("a1", 2), "10 / 10");
  assert.equal(page.cell("a1", 3), "5 / 5");
  assert.equal(page.cell("a1", 4), "100 %");
  assert.equal(page.cell("a1", 5), "Feedback: lost marks on Q2Rubric 4 / 4");
  assert.equal(page.cell("final", 2), "100 / 100");
  assert.equal(page.cell("final", 3), "100 %");
  // The item name and description are not grades.
  assert.equal(page.cell("a1", 1), "Assignment 1Due Monday");
});

test("applies a custom grade and comment per row", async () => {
  const page = await run(gradesUrl, table, {
    "course:123": {
      defaultGrade: "100",
      rows: {
        "Assignment 1": { grade: "9/10", comment: "Excellent work!" },
        "Final Calculated Grade": { grade: "92.5", comment: "" },
      },
    },
  });
  assert.equal(page.cell("a1", 2), "9 / 10");
  assert.equal(page.cell("a1", 3), "4.5 / 5");
  assert.equal(page.cell("a1", 4), "90 %");
  assert.equal(page.cell("a1", 5), "Excellent work!");
  assert.equal(page.cell("final", 2), "92.5 / 100");
  assert.equal(page.cell("final", 3), "92.5 %");
  assert.equal(page.cell("cat", 3), "100 %");
});

test("updates live when settings change and restores originals when disabled", async () => {
  const page = await run(gradesUrl, table);
  await page.setSettings({ rows: { "Assignment 1": { grade: "70", comment: "Nice" } } });
  assert.equal(page.cell("a1", 2), "7 / 10");
  assert.equal(page.cell("a1", 5), "Nice");

  await page.setSettings({ enabled: false, rows: { "Assignment 1": { grade: "70", comment: "Nice" } } });
  assert.equal(page.cell("a1", 2), "8.5 / 10");
  assert.equal(page.cell("a1", 4), "85 %");
  assert.equal(page.cell("a1", 5), "Feedback: lost marks on Q2Rubric 3 / 4");
});

test("reports rows with their original values to the side panel", async () => {
  const page = await run(gradesUrl, table);
  const { course, rows } = JSON.parse(JSON.stringify(page.getRows()));
  assert.equal(course, "123");
  assert.deepEqual(
    rows.map((row) => [row.key, row.points, row.grade]),
    [
      ["Final Calculated Grade", "", "78.5 %"],
      ["Assignments", "", "85 %"],
      ["Assignment 1", "8.5 / 10", "85 %"],
    ]
  );
});

test("re-applies when the page changes a score", async () => {
  const page = await run(gradesUrl, table);
  page.$("#a1").cells[4].textContent = "60 %";
  await flush();
  assert.equal(page.cell("a1", 4), "100 %");
  assert.equal(page.getRows().rows[2].grade, "60 %");
});

test("falls back to changing every score when no grades table is found", async () => {
  const page = await run(gradesUrl, "<p>3/9, -2.5 / 10.00, 4/4 and 50%</p><textarea>3/9</textarea>");
  assert.equal(page.$("p").textContent, "9/9, 10.00 / 10.00, 4/4 and 100%");
  assert.equal(page.$("textarea").value, "3/9");
});

test("only runs on the grades page with an ou parameter", async () => {
  for (const url of [
    "https://learn.uwaterloo.ca/d2l/lms/grades/my_grades/main.d2l",
    "https://learn.uwaterloo.ca/d2l/lms/grades/my_grades/main.d2l-other?ou=123",
  ]) {
    const page = await run(url, "<p>3/9</p>");
    assert.equal(page.$("p").textContent, "3/9");
    assert.equal(page.hasListeners(), false);
  }
});

test("parses grades typed in the side panel", async () => {
  const page = await run(gradesUrl, "");
  const { parseTarget } = page.window.LearnMarks;
  assert.equal(parseTarget("85"), 85);
  assert.equal(parseTarget(" 85 % "), 85);
  assert.equal(parseTarget("17/20"), 85);
  assert.equal(parseTarget("17 out of 20"), 85);
  assert.equal(parseTarget(""), null);
  assert.equal(parseTarget("A+"), null);
  assert.equal(parseTarget("5/0"), null);
});

const feedbackHtml = `
  <table>
    <tr><th>Grade Item</th><th>Points</th><th>Comments and Assessments</th></tr>
    <tr id="lab">
      <th>Lab 3</th><td>39 / 40</td>
      <td><p>Overall Feedback</p><p>Excellent work!</p><p>Q1: 4/4</p>
        <p>Q2: 6/6- Great map!</p><p>Q4: 19/20- Great map! Only data sources are missing.</p></td>
    </tr>
  </table>`;

const feedback = `Overall Feedback
Excellent work!

Q1: 4/4

Q2: 6/6- Great map!

Q3: 4/4

Q4: 19/20- Great map! Only data sources are missing.

Q5: 6/6`;

const cleaned = `Overall Feedback
Excellent work!

Q1: 4/4

Q2: 6/6

Q3: 4/4

Q4: 20/20

Q5: 6/6`;

function loadGemini(languageModel) {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  if (languageModel) dom.window.LanguageModel = languageModel;
  dom.window.eval(shared);
  dom.window.eval(readFileSync(path.join(__dirname, "gemini.js"), "utf8"));
  return dom.window;
}

function fakeModel(answer) {
  return {
    availability: async () => "available",
    create: async () => ({
      clone: async () => ({ prompt: async () => answer, destroy() {} }),
    }),
  };
}

test("built-in cleanup removes remarks after scores", async () => {
  const window = loadGemini();
  const { stripRemarks, rewriteScoresInText } = window.LearnMarks;
  assert.equal(rewriteScoresInText(stripRemarks(feedback), 100), cleaned);
});

test("cleans feedback with Gemini Nano and sets scores from the grade", async () => {
  const window = loadGemini(fakeModel(stripRemarks(feedback)));
  function stripRemarks(text) {
    return text.replace(/(\d+\/\d+)-.*$/gm, "$1");
  }
  const full = await window.LearnMarksGemini.cleanFeedback(feedback, 100);
  assert.deepEqual({ ...full }, { text: cleaned, usedGemini: true });

  // Below full marks the remarks explain the lost marks, so they stay.
  const ninety = await window.LearnMarksGemini.cleanFeedback(feedback, 90);
  assert.equal(ninety.usedGemini, false);
  assert.match(ninety.text, /Q1: 3\.6\/4\n\nQ2: 5\.4\/6- Great map!\n\nQ3: 3\.6\/4\n\nQ4: 18\/20- Great map! Only/);
});

test("feedback on the page matches the grade", async () => {
  const html = `
    <table>
      <tr><th>Grade Item</th><th>Points</th><th>Comments and Assessments</th></tr>
      <tr id="lab"><th>Lab 4</th><td>50 / 50</td>
        <td><fake-block></fake-block><template id="fb">
          <p>Overall Feedback</p>
          <p>Great work! Great level of effort and detail!</p>
          <p><strong>Part A:</strong> 10/10</p>
          <p><strong>Part B:</strong> 20/20 - Generally quite good, however, the type of edits are
            <em>not diverse enough</em>. Also, before and after screenshots would have been good.</p>
          <p><strong>Part C:</strong> 20/20</p>
        </template></td></tr>
    </table>`;
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: gradesUrl, runScripts: "outside-only" });
  dom.window.eval(`customElements.define("fake-block", class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "open" }).append(document.getElementById("fb").content.cloneNode(true));
    }
  });`);
  const changeListeners = [];
  const stored = {};
  dom.window.chrome = {
    storage: { local: { get: async (k) => ({ [k]: stored[k] }) }, onChanged: { addListener: (l) => changeListeners.push(l) } },
    runtime: { onMessage: { addListener() {} } },
  };
  dom.window.eval(shared);
  dom.window.eval(content);
  await flush();
  const feedbackText = () =>
    [...dom.window.document.querySelector("fake-block").shadowRoot.querySelectorAll("p")].map((p) =>
      p.textContent.replace(/\s+/g, " ").trim()
    );
  const setSettings = async (value) => {
    for (const listener of changeListeners) listener({ "course:123": { newValue: value } }, "local");
    await flush();
  };

  // Full marks: remarks after the scores go, the overall praise stays.
  assert.deepEqual(feedbackText(), [
    "Overall Feedback",
    "Great work! Great level of effort and detail!",
    "Part A: 10/10",
    "Part B: 20/20",
    "Part C: 20/20",
  ]);

  // Below full marks: the remark stays to explain the lost marks.
  await setSettings({ rows: { "Lab 4": { grade: "85" } } });
  assert.match(feedbackText()[3], /^Part B: 17\/20 - Generally quite good, however, the type of edits are not diverse enough\./);
  assert.equal(feedbackText()[2], "Part A: 8.5/10");

  // Turned off: full marks keep the original remark.
  await setSettings({ matchFeedback: false });
  assert.match(feedbackText()[3], /^Part B: 20\/20 - Generally quite good/);
});

test("falls back to built-in cleanup when Gemini drops a question or is missing", async () => {
  const dropped = loadGemini(fakeModel("Overall Feedback\nExcellent work!\n\nQ1: 4/4"));
  assert.deepEqual({ ...(await dropped.LearnMarksGemini.cleanFeedback(feedback, 100)) }, { text: cleaned, usedGemini: false });

  const missing = loadGemini();
  assert.deepEqual({ ...(await missing.LearnMarksGemini.cleanFeedback(feedback, 100)) }, { text: cleaned, usedGemini: false });
});

test("sends multi-line feedback to the side panel and keeps custom comment scores in step", async () => {
  const page = await run(gradesUrl, feedbackHtml);
  const [row] = JSON.parse(JSON.stringify(page.getRows())).rows;
  assert.equal(
    row.comments,
    "Overall Feedback\n\nExcellent work!\n\nQ1: 4/4\n\nQ2: 6/6- Great map!\n\nQ4: 19/20- Great map! Only data sources are missing."
  );

  await page.setSettings({ rows: { "Lab 3": { grade: "50", comment: "Q1: 4/4\nQ4: 20/20" } } });
  assert.equal(page.$("#lab").cells[2].textContent, "Q1: 2/4\nQ4: 10/20");
});

test("reads and rewrites feedback drawn inside a web component's shadow root", async () => {
  const dropboxFree = `
    <table>
      <tr><th>Grade Item</th><th>Points</th><th>Comments and Assessments</th></tr>
      <tr id="lab"><th>Lab 3</th><td>39 / 40</td>
        <td><fake-html-block><template><p>Q1: 4/4</p><p>Q4: 19/20- Great map!</p></template></fake-html-block></td></tr>
    </table>`;
  const dom = new JSDOM(`<!doctype html><body>${dropboxFree}</body>`, { url: gradesUrl, runScripts: "outside-only" });
  // Like LEARN's <d2l-html-block>: copies its template into an open shadow root.
  dom.window.eval(`customElements.define("fake-html-block", class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: "open" });
      root.append(this.querySelector("template").content.cloneNode(true));
    }
  });`);
  const listeners = [];
  dom.window.chrome = {
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } },
  };
  dom.window.eval(shared);
  dom.window.eval(content);
  await flush();

  const shadow = dom.window.document.querySelector("fake-html-block").shadowRoot;
  assert.equal(shadow.textContent, "Q1: 4/4Q4: 20/20");
  let response;
  listeners[0]({ type: "learnmarks:getRows" }, {}, (value) => (response = value));
  assert.equal(response.rows[0].comments, "Q1: 4/4\n\nQ4: 19/20- Great map!");
});

test("works on the Assignments page without touching dates", async () => {
  const assignmentsUrl = "https://learn.uwaterloo.ca/d2l/lms/dropbox/user/folders_list.d2l?ou=123&isprv=0";
  const page = await run(
    assignmentsUrl,
    `<table>
      <tr><th>Assignment</th><th>Completion Status</th><th>Score</th><th>Evaluation Status</th><th>Due Date</th></tr>
      <tr id="lab"><th><a>Lab 3</a></th><td>1 Submission, 1 File</td><td>39 / 40 - 97.5 %</td>
        <td>Feedback: Read</td><td>11/3/2025 11:59 PM</td></tr>
    </table>`,
    { "course:123": { rows: { "Lab 3": { grade: "90" } } } }
  );
  assert.equal(page.cell("lab", 2), "36 / 40 - 90 %");
  assert.equal(page.cell("lab", 4), "11/3/2025 11:59 PM");
  assert.deepEqual(JSON.parse(JSON.stringify(page.getRows().rows)), [
    { key: "Lab 3", name: "Lab 3", skip: null, points: "39 / 40 - 97.5 %" },
  ]);
});
