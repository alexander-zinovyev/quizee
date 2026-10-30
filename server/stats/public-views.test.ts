import assert from "node:assert/strict";
import test from "node:test";
import type { StatsHistoryResult } from "@/types/stats";
import { historyExtremes, resultStreaks } from "./history-metrics";
import { mediaByteRange } from "./media";
import { publicPercentage, publicQuestion } from "./serializers";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";
import { calculatePercentage } from "./metrics";

test("public question/percentage serializers discard private additions at every nesting level", () => {
  const question = normalizeRoomSource(roomSourceFixture(), "s1").rounds[0].questions[0];
  const raw = { ...question, sourceUid: "PRIVATE", prompt: question.prompt.map((stage) => ({ ...stage, storagePath: "PRIVATE" })),
    answers: { ...question.answers, red: { ...question.answers.red, user: "PRIVATE", attempts: [{ answer: "Answer", step: 0, submittedBy: "PRIVATE" }] } } };
  assert.equal(JSON.stringify(publicQuestion(raw)).includes("PRIVATE"), false);
  const percentage = calculatePercentage([]);
  const dirty = { ...percentage, secret: "PRIVATE", coverage: { ...percentage.coverage, privateNote: "PRIVATE", excluded: { "closest-pool": 1, PRIVATE: 42 } } };
  assert.equal(JSON.stringify(publicPercentage(dirty)).includes("PRIVATE"), false);
});

test("ties leave streaks unchanged; unknown dates/results prevent unsupported claims", () => {
  const history = (outcome: StatsHistoryResult["outcome"], index: number): StatsHistoryResult => ({ gameId: `g${index}`, completedAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, outcome, teamPoints: 0, provisional: false });
  const rows = [history("win", 0), history("tie", 1), history("win", 2), history("loss", 3), history("tie", 4), history("loss", 5)];
  const streaks = resultStreaks([...rows].reverse());
  assert.equal(streaks.longestWins, 2); assert.equal(streaks.currentWins, 0); assert.equal(streaks.currentLosses, 2);
  assert.equal(resultStreaks([...rows, { ...history("win", 6), completedAt: null }]).longestWins, null);
  assert.equal(resultStreaks([...rows, history("unavailable", 6)]).currentWins, null);
  assert.deepEqual(historyExtremes([{ gameId: "a", value: -2 }, { gameId: "b", value: -2 }, { gameId: "c", value: null }], false), [{ gameId: "a", value: -2 }, { gameId: "b", value: -2 }]);
});

test("published media ranges support normal, open-ended, and suffix playback requests", () => {
  assert.equal(mediaByteRange(null, 10), null);
  assert.deepEqual(mediaByteRange("bytes=0-4", 10), { start: 0, end: 4 });
  assert.deepEqual(mediaByteRange("bytes=5-", 10), { start: 5, end: 9 });
  assert.deepEqual(mediaByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(mediaByteRange("bytes=0-999", 10), { start: 0, end: 9 });
  for (const range of ["bytes=10-", "bytes=5-1", "bytes=-0", "bytes=", "bytes=0-1,3-4", "bytes=99999999999999999999-"]) assert.throws(() => mediaByteRange(range, 10));
});
