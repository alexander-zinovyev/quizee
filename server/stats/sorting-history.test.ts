import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StatsStages from "@/lib/components/stats/stages";
import type { StatsReview } from "@/types/stats";
import { inferQuestionMaximum } from "./metrics";
import { projectGame } from "./projection";
import { publicMetrics, publicQuestion } from "./serializers";
import { normalizeRoomSource } from "./source";
import { sortingRoomSourceFixture } from "./source.fixtures";
import { snapshotDocuments } from "./snapshots";

const review: StatsReview = { hostPersonId: null, mappings: {}, maxima: {}, completedAt: null, packLabel: null };

test("sorting history retains real Stage questions, correct/submitted positions and one-point maxima", () => {
  const snapshot = normalizeRoomSource(sortingRoomSourceFixture(), "sorting");
  const round = snapshot.rounds[0];
  assert.deepEqual(round.scoring, { type: "sorting" });
  assert.equal(round.criterion, "Earliest to latest");
  assert.equal(round.questionCount, 4);
  assert.deepEqual(round.questions.map((question) => question.id), ["A", "B", "C", "D"]);
  assert.deepEqual(round.questions.map((question) => question.acceptedAnswer[0].text), ["Position 1", "Position 2", "Position 3", "Position 4"]);
  assert.deepEqual(round.questions.map((question) => question.answers.blue.answer), ["Position 1", "Position 3", "Position 2", "Position 4"]);
  assert.deepEqual(round.questions.map((question) => question.answers.blue.correctness), [true, false, false, true]);
  assert.deepEqual(round.questions.map((question) => question.answers.blue.awardedPoints), [1, 0, 0, 1]);
  assert.deepEqual(inferQuestionMaximum(round.scoring), { points: 1, provenance: "configured" });
  assert.ok(round.questions.every((question) => question.prompt.length === 1));
  const mediaQuestion = round.questions.find((question) => question.id === "B")!;
  assert.equal(mediaQuestion.prompt[0].text, "Event B");
  assert.equal(snapshot.assets[mediaQuestion.prompt[0].assetId!].storagePath, "rooms/demo/media/event-b.png");
  assert.deepEqual(publicQuestion(mediaQuestion), mediaQuestion);
  const documents = snapshotDocuments(snapshot);
  const questionPaths = documents.filter((document) => /\/questions\/[^/]+$/.test(document.path)).map((document) => document.path.split("/").at(-1));
  assert.deepEqual(questionPaths, ["A", "B", "C", "D"], "Saved history must not invent an aggregate question wrapper");
});

test("sorting per-question awards reconcile standings and use N available points per team", () => {
  const snapshot = normalizeRoomSource(sortingRoomSourceFixture(), "sorting");
  const projection = projectGame(snapshot, review, 1), round = projection.metrics.rounds[0];
  assert.equal(round.type, "sorting");
  assert.equal(round.teams.red.percentage.value, 1);
  assert.equal(round.teams.blue.percentage.value, 0.5);
  assert.equal(round.teams.blue.reconciliation.status, "reconciled");
  assert.equal(projection.metrics.results.find((team) => team.id === "red")!.outcome, "win");
  assert.equal(projection.metrics.percentage.denominator, 8);
  assert.equal(projection.metrics.percentage.numerator, 6);
  assert.equal(publicMetrics(projection.metrics).rounds[0].criterion, "Earliest to latest");
});

test("sorting history preserves absent orders and unknown per-question awards without inventing points", () => {
  const source = sortingRoomSourceFixture();
  source.rounds[0].teamAnswers.red.metadata = null;
  delete source.rounds[0].teamAnswers.blue.metadata!.pointsByQuestion;
  const round = normalizeRoomSource(source, "missing").rounds[0];
  for (const question of round.questions) {
    assert.equal(question.answers.red.answer, null);
    assert.equal(question.answers.red.correctness, null);
    assert.equal(question.answers.red.awardedPoints, null);
    assert.equal(question.answers.blue.awardedPoints, null);
  }
  assert.deepEqual(round.questions.map((question) => question.answers.blue.answer), ["Position 1", "Position 3", "Position 2", "Position 4"]);
});

test("sorting history refuses malformed orders, question stages and award maps", () => {
  for (const order of [["A", "A", "C", "D"], ["A", "B"], ["A", "B", "C", "unknown"], "not an array", null]) {
    const source = sortingRoomSourceFixture();
    source.rounds[0].teamAnswers.red.metadata!.order = order;
    assert.throws(() => normalizeRoomSource(source, "invalid"));
    const invalidCorrect = sortingRoomSourceFixture();
    invalidCorrect.rounds[0].answers[0].data.correctOrder = order;
    assert.throws(() => normalizeRoomSource(invalidCorrect, "invalid"));
  }
  for (const stage of [{}, { stages: [{ text: "Old shape" }] }, { text: "A", stages: [] }, { media: { storagePath: "outside/room.png" } }]) {
    const source = sortingRoomSourceFixture();
    source.rounds[0].questions[0].data = stage;
    assert.throws(() => normalizeRoomSource(source, "invalid"));
  }
  for (const points of [{ unknown: 1 }, { A: NaN }, { A: -1 }, { A: "1" }, []]) {
    const source = sortingRoomSourceFixture();
    source.rounds[0].teamAnswers.red.metadata!.pointsByQuestion = points;
    assert.throws(() => normalizeRoomSource(source, "invalid"));
  }
  const source = sortingRoomSourceFixture();
  source.rounds[0].questions = source.rounds[0].questions.slice(0, 1);
  assert.throws(() => normalizeRoomSource(source, "invalid"));
});

test("sorting normalization is deterministic across question document delivery order", () => {
  const source = sortingRoomSourceFixture();
  const expected = normalizeRoomSource(source, "sorting");
  source.rounds[0].questions.reverse();
  assert.deepEqual(normalizeRoomSource(source, "sorting"), expected);
});

test("public sorting question serialization drops private source data", () => {
  const question = normalizeRoomSource(sortingRoomSourceFixture(), "sorting").rounds[0].questions[1];
  const dirty = { ...question, user: "PRIVATE", prompt: question.prompt.map((stage) => ({ ...stage, storagePath: "PRIVATE" })),
    answers: { ...question.answers, red: { ...question.answers.red, user: "PRIVATE" } } };
  assert.equal(JSON.stringify(publicQuestion(dirty)).includes("PRIVATE"), false);
});

test("sorting history renders each Stage with readable positions, image and audio media", () => {
  const snapshot = normalizeRoomSource(sortingRoomSourceFixture(), "sorting");
  const assets = Object.fromEntries(Object.entries(snapshot.assets).map(([id, value]) => [id, { filename: value.storagePath.split("/").at(-1)! }]));
  const html = snapshot.rounds[0].questions.map((question) => renderToStaticMarkup(createElement("section", null,
    createElement(StatsStages, { stages: question.prompt, assets, assetUrl: (id) => `/assets/${id}`, label: question.id }),
    createElement(StatsStages, { stages: question.acceptedAnswer, assets, assetUrl: (id) => `/assets/${id}`, label: "Correct position" }),
    createElement("p", null, `Blue submitted: ${question.answers.blue.answer}, points: ${question.answers.blue.awardedPoints}`),
  ))).join("");
  assert.ok(html.indexOf("Event A") < html.indexOf("Event B"));
  assert.ok(html.indexOf("Event B") < html.indexOf("<audio"));
  assert.ok(html.indexOf("<audio") < html.indexOf("Event D"));
  assert.match(html, /Position 2/);
  assert.match(html, /Blue submitted: Position 3, points: 0/);
  assert.match(html, /<audio/);
  assert.match(html, /<img/);
  assert.doesNotMatch(html, /Stage 1/);
});
