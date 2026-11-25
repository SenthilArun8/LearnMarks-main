// Shared by the content script and the side panel.
(() => {
  const number = String.raw`[-+]?\d+(?:\.\d+)?`;
  const fractionInput = new RegExp(String.raw`^(${number})\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)$`, "i");
  const percentInput = new RegExp(String.raw`^(${number})\s*%?$`);

  // Groups 1-3: "8.5 / 10" or "7 out of 10". Groups 4-5: "85 %".
  // Dates like 11/3/2025 are not scores.
  const SCORE =
    /(?<![\d./])([-+]?\d+(?:\.\d+)?)(\s*(?:\/|out of)\s*)(\d+(?:\.\d+)?)(?![\d.]|\/\d)|(?<![\d.]|\/\s*)([-+]?\d+(?:\.\d+)?)(\s*%)/dgi;

  // Turns what the user typed into a percentage: "85", "85%" or "17/20".
  // Returns null for empty or invalid input.
  function parseTarget(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const fraction = text.match(fractionInput);
    if (fraction) {
      const denominator = Number(fraction[2]);
      return denominator > 0 ? (Number(fraction[1]) / denominator) * 100 : null;
    }
    const percent = text.match(percentInput);
    return percent ? Number(percent[1]) : null;
  }

  const format = (value) => String(Number(value.toFixed(2)));

  // For a SCORE match, the range of the number to replace and its new value.
  function replacementFor(match, percent) {
    if (match[1] !== undefined) {
      const denominator = match[3];
      // Full marks copy the denominator exactly, so "x / 10.00" becomes "10.00 / 10.00".
      const value =
        percent === 100 ? denominator : format((percent * Number(denominator)) / 100);
      return { range: match.indices[1], value };
    }
    return { range: match.indices[4], value: format(percent) };
  }

  function rewriteScoresInText(text, percent) {
    let result = "";
    let last = 0;
    for (const match of text.matchAll(SCORE)) {
      const { range, value } = replacementFor(match, percent);
      result += text.slice(last, range[0]) + value;
      last = range[1];
    }
    return result + text.slice(last);
  }

  // The out-of values of the fractions in the text, in order, e.g. ["4", "6"].
  function denominators(text) {
    return [...text.matchAll(SCORE)].filter((m) => m[3] !== undefined).map((m) => Number(m[3]));
  }

  // Rule-based cleanup: drops whatever follows the last score on each line,
  // so "Q2: 6/6- Great map!" becomes "Q2: 6/6".
  function stripRemarks(text) {
    return text
      .split("\n")
      .map((line) => {
        const matches = [...line.matchAll(SCORE)];
        if (matches.length === 0) return line;
        const last = matches[matches.length - 1];
        return line.slice(0, last.index + last[0].length).trimEnd();
      })
      .join("\n");
  }

  // Checks that a rewrite kept every question score and didn't invent text.
  function isFaithfulRewrite(original, rewritten) {
    const text = String(rewritten ?? "").trim();
    if (!text || text.length > original.length * 1.2 + 20) return false;
    const before = denominators(original);
    const after = denominators(text);
    return before.length === after.length && before.every((value, i) => value === after[i]);
  }

  // A random whole-number grade from min to max, both included.
  function randomGrade(min, max = 100, random = Math.random) {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    return low + Math.floor(random() * (high - low + 1));
  }

  // Keeps only the extension's own entries from a backup file, so importing
  // a wrong or edited file can't write anything else.
  function backupEntries(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const source = data.app === "perfect-grade-display" && data.data ? data.data : data;
    const entries = {};
    for (const [key, value] of Object.entries(source)) {
      if (!/^(course|submissions):[\w-]+$/.test(key)) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (key.startsWith("course:")) {
        entries[key] = { ...normalizeSettings(value), rows: cleanRows(value.rows) };
      } else if (Array.isArray(value.notSubmitted)) {
        entries[key] = { notSubmitted: value.notSubmitted.filter((name) => typeof name === "string") };
      }
    }
    return Object.keys(entries).length ? entries : null;
  }

  function cleanRows(rows) {
    const result = {};
    if (!rows || typeof rows !== "object") return result;
    for (const [name, row] of Object.entries(rows)) {
      if (!row || typeof row !== "object") continue;
      result[name] = {
        grade: typeof row.grade === "string" ? row.grade : "",
        comment: typeof row.comment === "string" ? row.comment : "",
      };
    }
    return result;
  }

  function storageKey(course) {
    return `course:${course}`;
  }

  function normalizeSettings(value) {
    return {
      enabled: value?.enabled !== false,
      matchFeedback: value?.matchFeedback !== false,
      defaultGrade: typeof value?.defaultGrade === "string" ? value.defaultGrade : "100",
      randomMin: typeof value?.randomMin === "string" ? value.randomMin : "85",
      rows: value?.rows && typeof value.rows === "object" ? value.rows : {},
    };
  }

  globalThis.LearnMarks = {
    SCORE,
    parseTarget,
    replacementFor,
    rewriteScoresInText,
    stripRemarks,
    isFaithfulRewrite,
    randomGrade,
    backupEntries,
    storageKey,
    normalizeSettings,
  };
})();
