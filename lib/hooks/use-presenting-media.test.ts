import assert from "node:assert/strict";

import { getColorPreloadQuestions, usesStagedAnswerReveal } from "./use-presenting-media";

assert.equal(usesStagedAnswerReveal("text"), true);
assert.equal(usesStagedAnswerReveal("multi-step"), true);
assert.equal(usesStagedAnswerReveal("image"), false);
assert.equal(usesStagedAnswerReveal(null), false);
const questions = ["q1", "q2", "q3", "q4"].map((id, order) => ({ id, order, prompt: null, displayPrompt: id }));
assert.deepEqual(getColorPreloadQuestions(questions).map((q) => q.id), ["q1", "q2"]);
assert.deepEqual(getColorPreloadQuestions(questions, "q2").map((q) => q.id), ["q2", "q3"]);
assert.deepEqual(getColorPreloadQuestions(questions, "q4").map((q) => q.id), ["q4"]);

async function mediaResourceFailures() {
  const { loadMediaResource } = await import("@/lib/media/media-resource");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    assert.deepEqual(await loadMediaResource("https://media.example.test/clue.svg"), { url: "https://media.example.test/clue.svg", isBlob: false });
    for (const status of [403, 404, 500]) {
      globalThis.fetch = async () => new Response("Unavailable", { status });
      await assert.rejects(loadMediaResource("https://media.example.test/clue.svg"), new RegExp(`HTTP ${status}`));
    }
    const controller = new AbortController();
    globalThis.fetch = async () => { controller.abort(); throw new TypeError("Failed to fetch"); };
    await assert.rejects(loadMediaResource("https://media.example.test/clue.svg", controller.signal), (error: unknown) => error instanceof Error && error.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void mediaResourceFailures().catch((error) => { console.error(error); process.exitCode = 1; });
