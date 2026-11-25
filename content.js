(() => {
  const PAGES = [
    "/d2l/lms/grades/my_grades/main.d2l", // Grades
    "/d2l/lms/dropbox/user/folders_list.d2l", // Assignments (Dropbox)
  ];
  const url = new URL(location.href);
  if (!PAGES.includes(url.pathname) || !url.searchParams.has("ou")) {
    return;
  }

  const { SCORE, parseTarget, replacementFor, storageKey, normalizeSettings } = globalThis.LearnMarks;
  const course = url.searchParams.get("ou");
  const key = storageKey(course);
  const submissionsKey = `submissions:${course}`;
  let notSubmitted = new Set(); // Normalized names the Assignments page says aren't submitted.
  const normalizeName = (name) => name.replace(/\s+/g, " ").trim().toLowerCase();
  const SCORE_KINDS = ["points", "weight", "grade", "comments"];
  const BLOCK = /^(P|DIV|LI|UL|OL|TR|TABLE|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/;

  let settings = null;
  const original = new WeakMap(); // text node -> text before we touched it
  const written = new WeakMap(); // text node -> text we last wrote
  const savedChildren = new WeakMap(); // comments cell -> its original children

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TEMPLATE"]);
  const shadowRoots = new Set();

  // Visits nodes in page order, including inside web components' open shadow
  // roots (LEARN shows feedback inside <d2l-html-block>, which uses one).
  function walk(node, visit) {
    if (node.nodeType === Node.TEXT_NODE) {
      visit(node);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (SKIP.has(node.tagName) || node.isContentEditable) return;
      if (visit(node) === false) return;
      if (node.shadowRoot) {
        shadowRoots.add(node.shadowRoot);
        node.shadowRoot.childNodes.forEach((child) => walk(child, visit));
      }
    } else if (node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    node.childNodes.forEach((child) => walk(child, visit));
  }

  function textNodes(root) {
    const nodes = [];
    walk(root, (node) => {
      if (node.nodeType === Node.TEXT_NODE) nodes.push(node);
    });
    return nodes;
  }

  // Text of an element as the page shows it, including shadow roots.
  function visibleText(root) {
    return textNodes(root).map(originalOf).join("");
  }

  // If the page changed a node since we last wrote it, its new text is the original.
  function originalOf(node) {
    if (!original.has(node) || node.data !== written.get(node)) {
      original.set(node, node.data);
    }
    return original.get(node);
  }

  function write(node, value) {
    if (node.data !== value) node.data = value;
    written.set(node, value);
  }

  // Joins the original text of the given nodes in page order, with BREAK where
  // the page starts a new line. (A plain newline in HTML source is just a
  // space, so it can't mark lines.) Spans map the text back to its nodes.
  const BREAK = " ";
  function collect(roots) {
    let text = "";
    const spans = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const data = originalOf(node);
        spans.push({ node, start: text.length, end: text.length + data.length, data });
        // Newlines are real line breaks in our own comments and in <pre>.
        const keepsNewlines = node.parentElement?.closest("[data-learnmarks-comment], pre");
        text += keepsNewlines ? data.replace(/\n/g, BREAK) : data;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP.has(node.tagName) || node.isContentEditable) return;
      if (node.tagName === "BR") {
        text += BREAK;
        return;
      }
      const block = BLOCK.test(node.tagName);
      if (block) text += BREAK;
      if (node.shadowRoot) {
        shadowRoots.add(node.shadowRoot);
        node.shadowRoot.childNodes.forEach(visit);
      }
      node.childNodes.forEach(visit);
      if (block) text += BREAK;
    };
    roots.forEach(visit);
    return { text, spans };
  }

  // Rewrites every score in the roots as one piece of text, so a score split
  // across elements (like <b>8</b> / 10) is still found. With trimRemarks,
  // the remark after a full-mark score on the same line is removed, so
  // "Part B: 20/20 - not diverse enough" becomes "Part B: 20/20".
  // A percent of null restores the original text.
  function rewriteScores(roots, percent, { trimRemarks = false } = {}) {
    const { text, spans } = collect(roots);
    const edits = [];

    if (percent !== null) {
      for (const match of text.matchAll(SCORE)) {
        const { range, value } = replacementFor(match, percent);
        edits.push({ start: range[0], end: range[1], value });
        if (trimRemarks && percent >= 100) {
          const end = match.index + match[0].length;
          const lineEnd = text.indexOf(BREAK, end);
          const remarkEnd = lineEnd < 0 ? text.length : lineEnd;
          const remark = text.slice(end, remarkEnd);
          // Only text with words after the last score on its line.
          if (/[a-z]/i.test(remark) && [...remark.matchAll(SCORE)].length === 0) {
            edits.push({ start: end, end: remarkEnd, value: "" });
          }
        }
      }
    }

    for (const span of spans) {
      let data = span.data;
      const mine = edits
        .filter((edit) =>
          edit.value === ""
            ? edit.start < span.end && edit.end > span.start // Deletions can cross nodes.
            : edit.start >= span.start && edit.end <= span.end
        )
        .sort((a, b) => b.start - a.start);
      for (const edit of mine) {
        const start = Math.max(edit.start, span.start) - span.start;
        const end = Math.min(edit.end, span.end) - span.start;
        data = data.slice(0, start) + edit.value + data.slice(end);
      }
      write(span.node, data);
    }
  }

  // Swaps a comments cell's content for the custom comment, or puts the
  // original content back when the comment is empty.
  function setComment(cell, comment) {
    if (comment) {
      if (!savedChildren.has(cell)) savedChildren.set(cell, [...cell.childNodes]);
      const current = cell.firstElementChild;
      if (
        cell.childNodes.length !== 1 ||
        current?.getAttribute("data-learnmarks-comment") !== comment
      ) {
        const span = document.createElement("span");
        span.setAttribute("data-learnmarks-comment", comment);
        span.style.whiteSpace = "pre-wrap";
        span.textContent = comment;
        cell.replaceChildren(span);
      }
      return true;
    }
    if (savedChildren.has(cell)) {
      cell.replaceChildren(...savedChildren.get(cell));
      savedChildren.delete(cell);
    }
    return false;
  }

  // The cell's original text, with line breaks where the page shows them.
  function cellText(cell, { multiline = false } = {}) {
    const { text } = collect(savedChildren.get(cell) ?? [...cell.childNodes]);
    if (!multiline) return text.replace(/\s+/g, " ").trim();
    return text
      .split(BREAK)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function gridCells(row) {
    let position = 0;
    return [...row.cells].map((cell) => {
      const span = Math.max(1, cell.colSpan || 1);
      const result = { cell, start: position, end: position + span };
      position += span;
      return result;
    });
  }

  // Column headers on the Grades page (Grade Item, Points, Weight Achieved,
  // Grade, Comments and Assessments) and Assignments page (Assignment or
  // Folder, Score, Evaluation Status, Feedback).
  function columnKind(text) {
    const label = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!label || label.length > 40) return null;
    if (/^(grade item|assignments?|folders?|assignment folders?)\b/.test(label)) return "name";
    if (/completion|submission/.test(label)) return "status";
    if (/comment|assessment|feedback/.test(label)) return "comments";
    if (label.includes("weight")) return "weight";
    if (/point|score/.test(label)) return "points";
    if (label.includes("grade")) return "grade";
    return null;
  }

  function findGradeRows() {
    const found = [];
    const seen = new Map();
    for (const table of document.querySelectorAll("table")) {
      const rows = [...table.rows];
      const headerIndex = rows.findIndex((row) =>
        [...row.cells].some((cell) => columnKind(visibleText(cell)) === "name")
      );
      if (headerIndex < 0) continue;

      const columns = {};
      for (const { cell, start, end } of gridCells(rows[headerIndex])) {
        const kind = columnKind(visibleText(cell));
        if (kind && !columns[kind]) columns[kind] = { start, end };
      }

      for (const row of rows.slice(headerIndex + 1)) {
        const cells = {};
        for (const { cell, start, end } of gridCells(row)) {
          for (const [kind, column] of Object.entries(columns)) {
            if (start < column.end && end > column.start && !cells[kind]) {
              if (kind === "name" && !visibleText(cell).trim()) continue;
              cells[kind] = cell;
              break;
            }
          }
        }
        if (!cells.name || !SCORE_KINDS.some((kind) => cells[kind])) continue;

        const name = textNodes(cells.name)
          .map((node) => originalOf(node).trim())
          .find(Boolean);
        if (!name) continue;
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        found.push({ key: count === 1 ? name : `${name} (${count})`, name, cells, skip: skipReason(name, cells) });
      }
    }
    return found;
  }

  // Why the automatic features (default grade, random grades, filled
  // comments) should leave a row alone, or null if they shouldn't.
  function skipReason(name, cells) {
    const status = cells.status ? cellText(cells.status) : "";
    if (/not submitted|no submissions?\b|0 submissions?/i.test(status)) return "not submitted";
    if (notSubmitted.has(normalizeName(name))) return "not submitted";
    const scores = ["points", "weight", "grade"].filter((kind) => cells[kind]);
    const hasScore = scores.some((kind) => [...cellText(cells[kind]).matchAll(SCORE)].length > 0);
    if (scores.length > 0 && !hasScore) return "not graded";
    return null;
  }

  // On the Assignments page, remember which assignments aren't submitted, so
  // the Grades page can skip them too.
  let published = null;
  function publishSubmissions(rows) {
    if (url.pathname !== PAGES[1] || rows.length === 0) return;
    const names = rows
      .filter((row) => row.cells.status && /not submitted|no submissions?\b|0 submissions?/i.test(cellText(row.cells.status)))
      .map((row) => normalizeName(row.name))
      .sort();
    const value = JSON.stringify(names);
    if (value === published) return;
    published = value;
    chrome.storage.local.set({ [submissionsKey]: { notSubmitted: names } });
  }

  function apply() {
    if (!settings) return;
    const rows = findGradeRows();
    const fallback = parseTarget(settings.defaultGrade) ?? 100;

    if (rows.length === 0) {
      // No grades table recognized: change scores anywhere on the page.
      const percent = settings.enabled ? fallback : null;
      for (const node of textNodes(document.body ?? document)) rewriteScores([node], percent);
      return;
    }

    publishSubmissions(rows);

    for (const row of rows) {
      const custom = settings.rows[row.key] ?? {};
      // A typed grade always applies; the default never adds marks to work
      // that wasn't submitted or graded.
      const typed = parseTarget(custom.grade);
      const percent = !settings.enabled ? null : typed ?? (row.skip ? null : fallback);
      const comment = settings.enabled ? String(custom.comment ?? "").trim() : "";
      for (const kind of SCORE_KINDS) {
        const cell = row.cells[kind];
        if (!cell) continue;
        // A custom comment's scores also follow the row's grade.
        if (kind === "comments") setComment(cell, comment);
        rewriteScores([cell], percent, {
          trimRemarks: kind === "comments" && settings.matchFeedback,
        });
      }
    }
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 0);
  });

  const OPTIONS = { subtree: true, childList: true, characterData: true };
  const observed = new WeakSet();

  function run() {
    scheduled = false;
    apply();
    observer.takeRecords(); // Ignore the changes we just made.
    // Watch shadow roots too, since changes inside them don't reach the document.
    for (const root of shadowRoots) {
      if (!observed.has(root)) {
        observed.add(root);
        observer.observe(root, OPTIONS);
      }
    }
  }

  observer.observe(document, OPTIONS);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[key]) settings = normalizeSettings(changes[key].newValue);
    if (changes[submissionsKey]) notSubmitted = new Set(changes[submissionsKey].newValue?.notSubmitted ?? []);
    if (changes[key] || changes[submissionsKey]) run();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "learnmarks:getRows") return;
    const rows = findGradeRows().map(({ key: rowKey, name, cells, skip }) => {
      const row = { key: rowKey, name, skip };
      for (const kind of SCORE_KINDS) {
        if (cells[kind]) row[kind] = cellText(cells[kind], { multiline: kind === "comments" });
      }
      return row;
    });
    sendResponse({ course, rows });
  });

  chrome.storage.local.get([key, submissionsKey]).then((stored) => {
    settings = normalizeSettings(stored[key]);
    notSubmitted = new Set(stored[submissionsKey]?.notSubmitted ?? []);
    run();
    // Web components can draw their content after the page loads without
    // changing the page around them, so check again a few times.
    for (const delay of [500, 1500, 4000]) setTimeout(run, delay);
  });
})();
