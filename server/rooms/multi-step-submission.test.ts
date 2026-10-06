import assert from "node:assert/strict";
import { captureMultiStepAnswer, parsePointsPerStep, snapshotTeamAnswer } from "./multi-step-submission";
import { isAnswerCommitted, type TeamAnswer } from "@/lib/answers";

assert.deepEqual(parsePointsPerStep([0, 0.5, -2]), [0, 0.5, -2]);
for (const value of [[], null, [5, "bad", 3], [5, Infinity, 3]]) {
  assert.throws(() => parsePointsPerStep(value));
}
const input: TeamAnswer = { answer: " Paris ", locked: true, user: "player", attempts: [] };
const captured = captureMultiStepAnswer(input, 0, true, "first");
assert.equal(captured.answer, " Paris ");
assert.equal(captured.locked, true);
assert.deepEqual(captured.attempts, [{ answer: "Paris", step: 0, submittedAt: "first", submittedBy: "player" }]);
assert.equal(captureMultiStepAnswer(captured, 1, true, "later"), captured);
const reverted = { ...captured, answer: "Paris" };
assert.equal(captureMultiStepAnswer(reverted, 1, true, "later"), reverted);
const edited = captureMultiStepAnswer({ ...captured, answer: "London" }, 1, true, "later");
assert.equal(edited.attempts.length, 2);
assert.equal(edited.attempts[1].step, 1);
assert.equal(captureMultiStepAnswer(edited, 1, true, "again"), edited);
assert.equal(captureMultiStepAnswer(edited, 0, true, "again"), edited);
const permanent = captureMultiStepAnswer({ ...input, locked: false }, 0, false, "first");
assert.equal(permanent.locked, false);
assert.equal(isAnswerCommitted(false, permanent.attempts), true);
const later = { ...permanent, answer: "London" };
assert.equal(captureMultiStepAnswer(later, 1, false, "later"), later);
const empty = { ...input, answer: " " };
assert.equal(captureMultiStepAnswer(empty, 0, true, "now"), empty);
assert.deepEqual(snapshotTeamAnswer({ ...captured, answer: "Unrecorded change" }, "multi-step"), { attempts: captured.attempts });
assert.deepEqual(snapshotTeamAnswer(input, "text"), { answer: "Paris", user: "player" });
assert.throws(() => captureMultiStepAnswer(input, -1, true, "now"));
