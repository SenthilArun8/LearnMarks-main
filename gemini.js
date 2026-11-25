// Cleans up feedback with Gemini Nano (Chrome's on-device model), falling
// back to rule-based cleanup when the model is missing or its answer is wrong.
(() => {
  const { rewriteScoresInText, stripRemarks, isFaithfulRewrite } = globalThis.LearnMarks;

  const LANGUAGE = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };

  const INSTRUCTIONS = `You edit grading feedback. Rewrite the feedback the user sends so it reads like a perfect submission:
- After each question's score, delete any remark (praise or criticism), keeping only the label and the score.
- Delete any sentence that mentions mistakes, missing items, lost marks, deductions or suggestions for improvement.
- Keep headings and positive overall comments exactly as written.
- Never change, add or remove any number or question.
- Keep the same line breaks.
Reply with only the rewritten feedback.`;

  const EXAMPLE_IN = `Feedback
Good effort overall, but citations need work.

Part A: 3/5 - Missing units on the axis.

Part B: 8/8 Well done!

Part C: 2.5/4- see rubric`;

  const EXAMPLE_OUT = `Feedback
Good effort overall.

Part A: 3/5

Part B: 8/8

Part C: 2.5/4`;

  let base = null; // Promise of a prepared session, cloned for each request.

  async function status() {
    if (!globalThis.LanguageModel) return "unsupported";
    try {
      return await LanguageModel.availability(LANGUAGE);
    } catch {
      return "unavailable";
    }
  }

  // Must be first called from a click if the model still needs downloading.
  function session(onProgress) {
    base ??= LanguageModel.create({
      ...LANGUAGE,
      initialPrompts: [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: EXAMPLE_IN },
        { role: "assistant", content: EXAMPLE_OUT },
      ],
      monitor(m) {
        m.addEventListener("downloadprogress", (event) => onProgress?.(event.loaded));
      },
    }).catch((error) => {
      base = null;
      throw error;
    });
    return base;
  }

  // Returns { text, usedGemini }. The scores in the text follow `percent`.
  async function cleanFeedback(original, percent, onProgress) {
    // Below full marks, the remarks explain the lost marks, so keep them.
    if (percent < 100) return { text: rewriteScoresInText(original, percent), usedGemini: false };
    let cleaned = null;
    if (["available", "downloadable", "downloading"].includes(await status())) {
      try {
        const copy = await (await session(onProgress)).clone();
        try {
          const answer = (await copy.prompt(original)).trim();
          if (isFaithfulRewrite(original, answer)) cleaned = answer;
        } finally {
          copy.destroy();
        }
      } catch (error) {
        console.warn("Gemini Nano failed; using rule-based cleanup.", error);
      }
    }
    const usedGemini = cleaned !== null;
    return { text: rewriteScoresInText(cleaned ?? stripRemarks(original), percent), usedGemini };
  }

  globalThis.LearnMarksGemini = { status, cleanFeedback };
})();
