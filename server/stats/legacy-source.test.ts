import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoomSource } from "./source";
import { legacyRoomSourceFixture, roomSourceFixture } from "./source.fixtures";
import { projectGame } from "./projection";
import { publicQuestion } from "./serializers";

test("legacy image prompts and flat text retain question IDs, wording, answers and media", () => {
  const source = legacyRoomSourceFixture();
  source.rounds[0].questions[0].data.media = { storagePath: "rooms/legacy-demo/media/prompt.png" };
  const snapshot = normalizeRoomSource(source, "legacy");
  assert.deepEqual(snapshot.rounds.map((round) => round.questions.length), [3, 3]);
  for (const round of snapshot.rounds) {
    assert.equal(round.questions[0].id, "question-1");
    assert.equal(round.questions[0].prompt[0].text, "Legacy prompt 0");
  }
  assert.ok(snapshot.rounds[0].questions[0].prompt[0].assetId);
  assert.equal(snapshot.rounds[0].questions[2].prompt[0].text, null);
  assert.ok(snapshot.rounds[0].questions[2].prompt[0].assetId, "Media-only legacy prompts remain valid.");
  assert.equal(snapshot.rounds[0].questions[0].acceptedAnswer[0].text, "Legacy answer 0");
  assert.ok(snapshot.rounds[1].questions[0].acceptedAnswer[0].assetId);
  assert.ok(snapshot.rounds[1].questions[0].answers.blue.assetId);
  assert.equal(snapshot.rounds[1].questions[0].answers.blue.correctness, false);
  assert.equal(snapshot.rounds[1].questionCount, 4, "Distractors are not extra scored questions.");
});

test("complete legacy boolean grades recover one-point awards and all downstream percentages", () => {
  const source = legacyRoomSourceFixture();
  const before = structuredClone(source);
  const snapshot = normalizeRoomSource(source, "legacy");
  const projection = projectGame(snapshot, { hostPersonId: "host", maxima: {}, completedAt: null, packLabel: null,
    mappings: Object.fromEntries(snapshot.appearances.map((appearance) => [appearance.id,
      { personId: snapshot.sourceMembers[appearance.id], duplicateOf: null }])) }, 1);
  assert.deepEqual(source, before, "Normalization must not change source records.");
  assert.equal(projection.metrics.warnings.some((warning) => warning.code === "round-detail-unavailable"), false);
  assert.equal(projection.players.get("red-uid-0")!.percentage.value, 1);
  assert.equal(projection.players.get("blue-uid-0")!.percentage.value, 0);
  assert.equal(projection.host!.difficulty.value, 0.5);
  assert.deepEqual(projection.host!.teamPercentages, [0, 1]);
  for (const round of snapshot.rounds) {
    assert.equal(round.questions[0].answers.red.awardedPoints, 1);
    assert.equal(round.questions[0].answers.blue.awardedPoints, 0);
    assert.equal(round.questions[0].answers.red.awardedPointsProvenance, "legacy-correctness");
    assert.equal(publicQuestion(round.questions[0]).answers.red.awardedPointsProvenance, undefined, "Recovery provenance stays in the private snapshot.");
    assert.equal(projection.metrics.rounds.find((metric) => metric.id === round.id)!.teams.red.reconciliation.status, "reconciled");
  }
  source.rounds.reverse();
  source.rounds.forEach((round) => { round.questions.reverse(); round.prompts?.reverse(); round.answers.reverse(); });
  assert.equal(normalizeRoomSource(source, "reordered").digest, snapshot.digest);
});

test("image recovery requires complete prompt/answer sets and consistent recorded correctness", () => {
  for (const change of [
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].prompts!.pop(); },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].answers.pop(); },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].teamAnswers.red.answers.pop(); },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].teamAnswers.red.answers[0].data.correct = false; },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].images.shift(); },
  ]) {
    const source = legacyRoomSourceFixture(); change(source);
    const snapshot = normalizeRoomSource(source, "incomplete-image");
    assert.ok(snapshot.rounds[1].questions.every((question) => question.answers.red.awardedPoints === null), change.toString());
  }
  const source = legacyRoomSourceFixture();
  source.teams[0].scores[1].data.score = 2;
  const snapshot = normalizeRoomSource(source, "one-team-mismatch");
  assert.equal(snapshot.rounds[1].questions[0].answers.red.awardedPoints, null);
  assert.equal(snapshot.rounds[1].questions[0].answers.blue.awardedPoints, 0, "Recovery is checked separately for each team-round.");
});

test("legacy award recovery requires complete, finalized, matching evidence for each team-round", () => {
  const changes: Array<(source: ReturnType<typeof legacyRoomSourceFixture>) => void> = [
    (source) => { source.rounds[0].teamAnswers.red.metadata!.graded = false; },
    (source) => { delete source.rounds[0].teamAnswers.red.metadata!.graded; },
    (source) => { source.rounds[0].data.gradingRequired = true; },
    (source) => { delete source.rounds[0].data.gradingRequired; },
    (source) => { delete source.rounds[0].teamAnswers.red.answers[0].data.correct; },
    (source) => { source.rounds[0].teamAnswers.red.answers.pop(); },
    (source) => { source.rounds[0].answers.pop(); },
    (source) => { source.rounds[0].questions.pop(); },
    (source) => { source.teams[0].scores[0].data.score = 2; },
    (source) => { source.teams[0].scores.splice(0, 1); },
    (source) => { source.rounds[0].data.allowWager = true; },
    (source) => { source.rounds[0].data.allowWager = null; },
    (source) => { source.rounds[0].teamAnswers.red.answers[0].data.awardedPoints = null; },
  ];
  for (const change of changes) {
    const source = legacyRoomSourceFixture(); change(source);
    const snapshot = normalizeRoomSource(source, "incomplete");
    assert.equal(snapshot.rounds[0].questions[0].answers.red.awardedPoints, null, change.toString());
    assert.equal(snapshot.rounds[1].questions[0].answers.red.awardedPoints, 1, "Other rounds retain their valid evidence.");
  }
});

test("modern missing awards and mixed explicit awards are never filled from correctness", () => {
  const modern = roomSourceFixture(4, 3);
  for (const round of modern.rounds) for (const answer of round.teamAnswers.red.answers) {
    delete answer.data.awardedPoints; answer.data.correct = true;
  }
  const normalized = normalizeRoomSource(modern, "modern");
  assert.ok(normalized.rounds.every((round) => round.questions.every((question) => question.answers.red.awardedPoints === null)));
  for (const explicit of [0, -2, 0.5]) {
    const legacy = legacyRoomSourceFixture();
    legacy.rounds[0].teamAnswers.red.answers[0].data.awardedPoints = explicit;
    const questions = normalizeRoomSource(legacy, "mixed").rounds[0].questions;
    assert.equal(questions[0].answers.red.awardedPoints, explicit);
    assert.equal(questions[1].answers.red.awardedPoints, null);
  }
});

test("ambiguous image collections and malformed legacy prompts or grades are refused", () => {
  for (const change of [
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[1].questions = [{ id: "other", data: { text: "Modern" } }]; },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[0].questions[0].data.prompt = 123; },
    (source: ReturnType<typeof legacyRoomSourceFixture>) => { source.rounds[0].teamAnswers.red.answers[0].data.correct = "yes"; },
  ]) {
    const source = legacyRoomSourceFixture(); change(source);
    assert.throws(() => normalizeRoomSource(source, "invalid"), { code: "malformed-source" });
  }
});
