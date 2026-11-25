const { SCORE, parseTarget, randomGrade, backupEntries, storageKey, normalizeSettings } = globalThis.LearnMarks;
const { status: geminiStatus, cleanFeedback } = globalThis.LearnMarksGemini;

const $ = (id) => document.getElementById(id);
let course = null;
let settings = null;
let generators = []; // One per row with scores in its comments.
let gradeInputs = []; // { key, input } for every row.

// chrome.storage.local is kept on disk, so settings survive closing Chrome.
function save() {
  chrome.storage.local.set({ [storageKey(course)]: settings }).catch((error) => {
    setStatus(`Couldn't save: ${error.message}. Export a backup to keep your grades safe.`);
  });
}

function markValidity(input) {
  input.classList.toggle("invalid", input.value.trim() !== "" && parseTarget(input.value) === null);
}

function current(row) {
  return [
    row.points && `Points: ${row.points}`,
    row.weight && `Weight: ${row.weight}`,
    row.grade && `Grade: ${row.grade}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function rowSettings(key) {
  settings.rows[key] ??= { grade: "", comment: "" };
  return settings.rows[key];
}

function rowPercent(key) {
  return parseTarget(settings.rows[key]?.grade) ?? parseTarget(settings.defaultGrade) ?? 100;
}

function setStatus(text) {
  $("status").textContent = text;
}

async function showGeminiStatus() {
  const messages = {
    available: "Gemini Nano is ready.",
    downloadable: "Gemini Nano will download the first time you generate (a few minutes).",
    downloading: "Gemini Nano is downloading…",
    unavailable: "Gemini Nano isn't available on this device; using built-in cleanup.",
    unsupported: "This Chrome has no built-in Gemini; using built-in cleanup.",
  };
  setStatus(messages[await geminiStatus()] ?? messages.unavailable);
}

function hasScores(text) {
  return [...String(text ?? "").matchAll(SCORE)].length > 0;
}

function renderRows(rows) {
  const list = $("rows");
  list.replaceChildren();
  generators = [];
  gradeInputs = [];
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No grade rows found on this page. The default applies to every score on the page.";
    list.append(empty);
    return;
  }
  for (const row of rows) {
    const stored = settings.rows[row.key] ?? {};
    const item = document.createElement("div");
    item.className = "row";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = row.name;

    const grade = document.createElement("input");
    grade.type = "text";
    // Skipped rows keep their real grade unless one is typed in.
    grade.placeholder = row.skip ? "—" : settings.defaultGrade || "100";
    grade.value = stored.grade ?? "";
    grade.setAttribute("aria-label", `Grade for ${row.name}`);
    markValidity(grade);
    grade.addEventListener("input", () => {
      markValidity(grade);
      rowSettings(row.key).grade = grade.value;
      save();
    });
    gradeInputs.push({ key: row.key, input: grade, skip: row.skip });

    const info = document.createElement("div");
    info.className = "current";
    info.textContent = current(row) || "No score shown";
    if (row.skip) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = row.skip === "not submitted" ? "Not submitted" : "Not graded";
      tag.title = "Automatic grades and comments skip this row. Type a grade to set one anyway.";
      info.prepend(tag, " ");
    }

    item.append(name, grade, info);

    if (row.comments !== undefined) {
      const comment = document.createElement("textarea");
      comment.rows = 1;
      comment.placeholder = row.comments ? `Keep: ${row.comments}` : "Comment (optional)";
      comment.value = stored.comment ?? "";
      comment.setAttribute("aria-label", `Comment for ${row.name}`);
      comment.addEventListener("input", () => {
        rowSettings(row.key).comment = comment.value;
        save();
      });
      item.append(comment);

      if (hasScores(row.comments)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "generate";
        button.textContent = "✨ Clean up feedback";
        const generate = async () => {
          button.disabled = true;
          button.textContent = "Generating…";
          try {
            const { text, usedGemini } = await cleanFeedback(row.comments, rowPercent(row.key), (loaded) =>
              setStatus(`Downloading Gemini Nano… ${Math.round(loaded * 100)}%`)
            );
            comment.value = text;
            comment.style.height = "auto";
            comment.style.height = `${comment.scrollHeight + 2}px`;
            rowSettings(row.key).comment = text;
            save();
            return usedGemini;
          } finally {
            button.disabled = false;
            button.textContent = "✨ Clean up feedback";
          }
        };
        button.addEventListener("click", async () => {
          const usedGemini = await generate();
          setStatus(
            rowPercent(row.key) < 100
              ? "Below full marks, so the remarks were kept to explain the lost marks; only the scores changed."
              : usedGemini
                ? "Cleaned up with Gemini Nano."
                : "Cleaned up with built-in rules."
          );
        });
        generators.push({ comment, generate, skip: row.skip });
        item.append(button);
      }
    }
    list.append(item);
  }
}

async function load() {
  let response = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      response = await chrome.tabs.sendMessage(tab.id, { type: "learnmarks:getRows" });
    }
  } catch {
    response = null; // No content script in this tab.
  }

  $("empty").hidden = Boolean(response);
  $("editor").hidden = !response;
  if (!response) return;

  course = response.course;
  const key = storageKey(course);
  settings = normalizeSettings((await chrome.storage.local.get(key))[key]);
  $("enabled").checked = settings.enabled;
  $("match-feedback").checked = settings.matchFeedback;
  $("default").value = settings.defaultGrade;
  $("random-min").value = settings.randomMin;
  markValidity($("default"));
  renderRows(response.rows);
  showGeminiStatus();
}

$("enabled").addEventListener("change", () => {
  settings.enabled = $("enabled").checked;
  save();
});

$("match-feedback").addEventListener("change", () => {
  settings.matchFeedback = $("match-feedback").checked;
  save();
});

$("default").addEventListener("input", () => {
  const input = $("default");
  markValidity(input);
  settings.defaultGrade = input.value;
  for (const { input: field, skip } of gradeInputs) {
    if (!skip) field.placeholder = input.value || "100";
  }
  save();
});

$("clear").addEventListener("click", () => {
  settings.rows = {};
  save();
  for (const field of document.querySelectorAll(".row input, .row textarea")) {
    field.value = "";
    field.classList.remove("invalid");
  }
});

$("random-min").addEventListener("input", () => {
  settings.randomMin = $("random-min").value;
  save();
});

// Gives every row a random whole-number grade from the chosen minimum to 100.
$("randomize").addEventListener("click", () => {
  const min = Number($("random-min").value);
  if ($("random-min").value.trim() === "" || !(min >= 0 && min <= 100)) {
    setStatus("Enter a minimum from 0 to 100 to randomize.");
    return;
  }
  if (gradeInputs.length === 0) {
    setStatus("There are no rows on this page to randomize.");
    return;
  }
  let given = 0;
  for (const { key, input, skip } of gradeInputs) {
    // No marks for work that wasn't submitted or graded (and clear any
    // random grade it got before).
    input.value = skip ? "" : String(randomGrade(min, 100));
    input.classList.remove("invalid");
    rowSettings(key).grade = input.value;
    if (!skip) given += 1;
  }
  save();
  const skipped = gradeInputs.length - given;
  setStatus(
    `Gave ${given} rows random grades from ${Math.ceil(min)} to 100` +
      (skipped ? `, skipped ${skipped} not submitted or not graded` : "") +
      ". Click again to re-roll."
  );
});

// Fills every empty comment box whose original feedback has scores in it.
$("fill").addEventListener("click", async () => {
  if (generators.length === 0) {
    setStatus(
      "No feedback with question scores (like Q1: 4/4) was found in this page's table. " +
        "Click Refresh once the page has finished loading."
    );
    return;
  }
  const todo = generators.filter(({ comment, skip }) => !skip && !comment.value.trim());
  if (todo.length === 0) {
    setStatus("Every comment with scores is already filled in.");
    return;
  }
  $("fill").disabled = true;
  let withGemini = 0;
  try {
    for (const [index, { generate }] of todo.entries()) {
      setStatus(`Cleaning up feedback ${index + 1} of ${todo.length}…`);
      if (await generate()) withGemini += 1;
    }
    setStatus(
      `Filled ${todo.length} comment${todo.length === 1 ? "" : "s"}` +
        (withGemini === todo.length ? " with Gemini Nano." : ` (${withGemini} with Gemini Nano, the rest with built-in rules).`)
    );
  } finally {
    $("fill").disabled = false;
  }
});

// Backups: a file outside Chrome that survives removing the extension or
// moving its folder (which gives it a new ID and empty storage).
async function exportBackup() {
  const all = await chrome.storage.local.get(null);
  const data = backupEntries(all) ?? {};
  const file = new Blob(
    [JSON.stringify({ app: "perfect-grade-display", version: 1, exported: new Date().toISOString(), data }, null, 2)],
    { type: "application/json" }
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `perfect-grade-display-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  const courses = Object.keys(data).filter((k) => k.startsWith("course:")).length;
  setBackupStatus(`Exported ${courses} course${courses === 1 ? "" : "s"}. Keep the file somewhere safe.`);
}

async function importBackup(file) {
  let entries = null;
  try {
    entries = backupEntries(JSON.parse(await file.text()));
  } catch {
    entries = null;
  }
  if (!entries) {
    setBackupStatus("That file isn't a Perfect Grade Display backup.");
    return;
  }
  await chrome.storage.local.set(entries);
  const courses = Object.keys(entries).filter((k) => k.startsWith("course:")).length;
  setBackupStatus(`Restored ${courses} course${courses === 1 ? "" : "s"}.`);
  load();
}

function setBackupStatus(text) {
  $("backup-status").textContent = text;
}

$("export").addEventListener("click", () =>
  exportBackup().catch((error) => setBackupStatus(`Export failed: ${error.message}`))
);
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", () => {
  const [file] = $("import-file").files;
  $("import-file").value = "";
  if (file) importBackup(file).catch((error) => setBackupStatus(`Import failed: ${error.message}`));
});

$("refresh").addEventListener("click", load);
$("retry").addEventListener("click", load);
chrome.tabs.onActivated.addListener(load);
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status === "complete" && tab.active) load();
});

load();
