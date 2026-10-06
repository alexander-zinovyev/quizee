import assert from "node:assert/strict";
import { isAnswerCommitted, latestAttempt, parseAttempts, parseTeamAnswer, recordedAnswer } from "./answers";

const attempts = [{ answer: "Paris", step: 0, submittedAt: "now", submittedBy: "player" }];
assert.equal(latestAttempt([]), undefined);
assert.equal(isAnswerCommitted(false, attempts), true);
assert.equal(isAnswerCommitted(true, attempts), false);
assert.equal(isAnswerCommitted(false, []), false);
assert.deepEqual(parseAttempts(undefined), []);
assert.deepEqual(recordedAnswer({ answer: "Unrecorded", submittedStep: 9, eligiblePoints: 999, attempts }, "multi-step"), { answer: "Paris", step: 0 });
assert.deepEqual(recordedAnswer({ answer: "Text answer", attempts }, "text"), { answer: "Text answer", step: null });
assert.deepEqual(parseTeamAnswer({ answer: "New input", locked: false, user: "player", attempts, eligiblePoints: 999 }),
  { answer: "New input", locked: false, user: "player", attempts });
for (const history of [null, {}, [{ ...attempts[0], step: -1 }], [{ ...attempts[0], step: 0.5 }],
  [{ ...attempts[0], step: Infinity }], [attempts[0], attempts[0]], [{ ...attempts[0], answer: " " }]]) {
  assert.throws(() => parseAttempts(history));
}
assert.throws(() => parseTeamAnswer({ answer: "A", locked: "false", user: "player" }));
