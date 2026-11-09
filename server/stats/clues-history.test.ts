import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";
import { inferQuestionMaximum } from "./metrics";

test("clues history preserves final awards with a fixed one-point maximum", () => {
  const source = roomSourceFixture(1, 2);
  source.rounds[0].data.type = "clues";
  source.rounds[0].data.startingCoins = 5;
  source.rounds[0].questions[0].data.clues = [{ id: "a", category: "History", price: 2 }];
  source.rounds[0].teamAnswers.red.answers[0].data.awardedPoints = 0.5;
  const snapshot = normalizeRoomSource(source, "clues");
  assert.deepEqual(snapshot.rounds[0].scoring, { type: "clues" });
  assert.deepEqual(inferQuestionMaximum(snapshot.rounds[0].scoring), { points: 1, provenance: "configured" });
  assert.equal(snapshot.rounds[0].questions[0].answers.red.awardedPoints, 0.5);
  assert.equal(snapshot.rounds[0].questions[0].answers.blue.awardedPoints, 0);
  assert.deepEqual(snapshot.rounds[0].questions[0].acceptedAnswer, [{ text: "Answer 0", assetId: null }]);
  assert.ok(!JSON.stringify(snapshot).includes("remainingCoins"));
});
