import assert from "node:assert/strict";

import { usesStagedAnswerReveal } from "./use-presenting-media";

assert.equal(usesStagedAnswerReveal("text"), true);
assert.equal(usesStagedAnswerReveal("multi-step"), true);
assert.equal(usesStagedAnswerReveal("image"), false);
assert.equal(usesStagedAnswerReveal(null), false);
