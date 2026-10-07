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
