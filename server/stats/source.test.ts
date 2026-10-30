import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";
import { snapshotDocuments } from "./snapshots";

test("all four round layouts retain signed/fractional awards without inventing correctness", () => {
  const snapshot = normalizeRoomSource(roomSourceFixture(), "snapshot");
  assert.equal(snapshot.rounds.length, 9);
  assert.equal(snapshot.appearances.length, 6);
  assert.equal(snapshot.teams.length, 2);
  assert.equal(snapshot.completedAt, null);
  assert.equal(snapshot.packLabel, null);
  assert.equal(snapshot.rounds[0].questions[0].answers.red.correctness, null);
  assert.equal(snapshot.rounds[1].questions[0].answers.red.correctness, true);
  assert.equal(snapshot.rounds[2].questions[0].answers.blue.awardedPoints, -2);
  assert.equal(snapshot.rounds[3].questions[0].answers.red.awardedPoints, 0.5);
  assert.equal(snapshot.rounds[3].questions[0].answers.red.correctness, null);
  assert.equal(snapshot.rounds[7].questions[0].answers.blue.correctness, false);
  assert.ok(snapshot.rounds[1].questions[0].acceptedAnswer[0].assetId);
  assert.ok(snapshot.rounds[1].questions[0].answers.red.assetId);
  assert.equal(snapshot.rounds[0].gradingIncomplete, false);
  assert.equal(snapshot.rounds[0].questions[0].answers.red.answer, "An answer");
  assert.equal(snapshot.rounds[2].questions[0].answers.red.attempts[0].step, 0);
});

test("normalization is deterministic across read timestamps and document return order", () => {
  const source = roomSourceFixture();
  const first = normalizeRoomSource(source, "first");
  source.readAt = "2026-10-29T13:00:00.000Z";
  source.members.reverse(); source.teams.reverse(); source.rounds.reverse();
  source.rounds.forEach((round) => { round.questions.reverse(); round.answers.reverse(); round.images.reverse(); });
  const second = normalizeRoomSource(source, "second");
  assert.equal(first.digest, second.digest);
  assert.notEqual(first.snapshotAt, second.snapshotAt);
  source.teams[0].data.scoreTotal = 999;
  assert.notEqual(normalizeRoomSource(source, "third").digest, first.digest);
});

test("accepted answer hints survive independently of staged explanations", () => {
  const source = roomSourceFixture();
  source.rounds[0].answers[0].data.hint = "Paris";
  source.rounds[0].answers[0].data.stages = [{ text: "The explanation of the answer" }];
  const snapshot = normalizeRoomSource(source, "hint");
  assert.equal(snapshot.rounds[0].questions[0].answerHint, "Paris");
});

test("absent records differ from explicitly blank frozen answers", () => {
  const source = roomSourceFixture();
  source.rounds[0].teamAnswers.red.answers[0].data = { answer: "", awardedPoints: 0 };
  source.rounds[0].teamAnswers.blue.answers = [];
  source.rounds[2].teamAnswers.red.answers[0].data = { awardedPoints: 0 };
  source.rounds[2].teamAnswers.blue.answers[0].data = { attempts: [], awardedPoints: 0 };
  const snapshot = normalizeRoomSource(source, "blank");
  assert.equal(snapshot.rounds[0].questions[0].answers.red.answer, "");
  assert.equal(snapshot.rounds[0].questions[0].answers.blue.answer, null);
  assert.equal(snapshot.rounds[0].questions[0].answers.blue.awardedPoints, null);
  assert.equal(snapshot.rounds[2].questions[0].answers.red.answer, null);
  assert.equal(snapshot.rounds[2].questions[0].answers.blue.answer, "");
});

test("malformed input is refused while genuinely missing history remains unavailable", () => {
  for (const change of [
    (source: ReturnType<typeof roomSourceFixture>) => { source.teams[0].data.scoreTotal = Infinity; },
    (source: ReturnType<typeof roomSourceFixture>) => { source.rounds[0].data.type = "unsupported"; },
    (source: ReturnType<typeof roomSourceFixture>) => { source.rounds[0].data.state = "active"; },
    (source: ReturnType<typeof roomSourceFixture>) => { source.rounds[2].data.pointsPerStep = [NaN]; },
    (source: ReturnType<typeof roomSourceFixture>) => { source.rounds[1].images[0].data.media = { storagePath: "rooms/other/media/private.png" }; },
    (source: ReturnType<typeof roomSourceFixture>) => { source.members[0].data.team = "missing"; },
  ]) { const source = roomSourceFixture(); change(source); assert.throws(() => normalizeRoomSource(source, "bad")); }
  const missing = roomSourceFixture();
  delete missing.rounds[2].data.pointsPerStep;
  missing.rounds[0].questions = [];
  missing.teams[0].scores = [];
  const snapshot = normalizeRoomSource(missing, "missing");
  assert.equal(snapshot.rounds[2].scoring.type, "multi-step");
  assert.equal(snapshot.rounds[0].questionCount, 10);
  assert.equal(snapshot.rounds[0].questions.length, 0);
  assert.equal(snapshot.rounds[0].teamScores.red, null);
});

test("the representative game uses bounded snapshot documents rather than one game-sized document", () => {
  const snapshot = normalizeRoomSource(roomSourceFixture(), "sizing");
  const documents = snapshotDocuments(snapshot);
  assert.equal(documents[0].data.ready, false);
  assert.equal(documents[0].data.documentCount, documents.length);
  assert.equal(documents.filter((document) => /\/questions\/[^/]+\/answers\//.test(document.path)).length, 180);
  assert.equal(documents.filter((document) => /\/appearances\//.test(document.path)).length, 6);
  const sizes = documents.map((document) => Buffer.byteLength(JSON.stringify(document.data), "utf8"));
  assert.ok(Math.max(...sizes) < 64 * 1024);
  assert.ok(sizes.reduce((total, size) => total + size, 0) < 1024 * 1024);
  console.log(`Representative snapshot: ${documents.length} documents, ${sizes.reduce((total, size) => total + size, 0)} JSON bytes, largest ${Math.max(...sizes)} JSON bytes (excludes media payloads).`);
});
