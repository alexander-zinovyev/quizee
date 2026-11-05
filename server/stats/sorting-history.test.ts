import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SortingOrder from "@/lib/components/stats/sorting-order";
import type { StatsReview, StatsRoundScoring } from "@/types/stats";
import { inferQuestionMaximum } from "./metrics";
import { projectGame } from "./projection";
import { publicQuestion } from "./serializers";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";

function sortingSource() {
  const source = roomSourceFixture(1, 1);
  const round = source.rounds[0];
  round.data = { ...round.data, type: "sorting", title: "Timeline" };
  round.questions[0].data = { order: 0, stages: [{ text: "Earliest to latest" }], items: [
    { id: "B", stages: [{ text: "Event B" }, { media: { storagePath: "rooms/demo/media/event-b.png" } }] },
    { id: "D", stages: [{ text: "Event D" }] },
    { id: "A", stages: [{ text: "Event A" }] },
    { id: "C", stages: [{ media: { storagePath: "rooms/demo/media/event-c.mp3" } }] },
  ] };
  round.answers[0].data = { correctOrder: ["A", "B", "C", "D"] };
  for (const team of source.teams) {
    const points = team.id === "red" ? 4 : 2;
    round.teamAnswers[team.id].answers[0].data = {
      answer: JSON.stringify(team.id === "red" ? ["A", "B", "C", "D"] : ["A", "C", "B", "D"]), awardedPoints: points,
    };
    team.data.scoreTotal = points;
    team.scores[0].data.score = points;
  }
  return source;
}

test("sorting history retains item stages, authored and submitted orders, and configured maxima", () => {
  const snapshot = normalizeRoomSource(sortingSource(), "sorting");
  const round = snapshot.rounds[0], question = round.questions[0];
  assert.deepEqual(round.scoring, { type: "sorting", itemCount: 4 });
  assert.deepEqual(inferQuestionMaximum(round.scoring), { points: 4, provenance: "configured" });
  assert.deepEqual(question.sorting?.correctOrder, ["A", "B", "C", "D"]);
  assert.deepEqual(question.answers.blue.sortingOrder, ["A", "C", "B", "D"]);
  assert.equal(question.answers.red.correctness, true);
  assert.equal(question.answers.blue.correctness, false);
  assert.equal(question.answers.blue.awardedPoints, 2);
  const mediaItem = question.sorting!.items.find((item) => item.id === "B")!;
  assert.equal(mediaItem.stages[0].text, "Event B");
  assert.equal(snapshot.assets[mediaItem.stages[1].assetId!].storagePath, "rooms/demo/media/event-b.png");
  const serialized = publicQuestion(question);
  assert.deepEqual(serialized.sorting, question.sorting);
  assert.deepEqual(serialized.answers.blue.sortingOrder, question.answers.blue.sortingOrder);
});

test("sorting awards flow into final standings and ordinary point percentages", () => {
  const snapshot = normalizeRoomSource(sortingSource(), "sorting");
  const review: StatsReview = { hostPersonId: null, mappings: {}, maxima: {}, completedAt: null, packLabel: null };
  const projection = projectGame(snapshot, review, 1), round = projection.metrics.rounds[0];
  assert.equal(round.type, "sorting");
  assert.equal(round.teams.red.percentage.value, 1);
  assert.equal(round.teams.blue.percentage.value, 0.5);
  assert.equal(round.teams.blue.reconciliation.status, "reconciled");
  assert.equal(projection.metrics.results.find((team) => team.id === "red")!.outcome, "win");
  assert.equal(projection.metrics.percentage.denominator, 8);
  assert.equal(projection.metrics.percentage.numerator, 6);
});

test("sorting history preserves blank and absent submissions and refuses malformed permutations", () => {
  const source = sortingSource();
  source.rounds[0].teamAnswers.red.answers[0].data = { answer: "", awardedPoints: 0 };
  source.rounds[0].teamAnswers.blue.answers = [];
  const question = normalizeRoomSource(source, "blank").rounds[0].questions[0];
  assert.equal(question.answers.red.answer, "");
  assert.equal(question.answers.red.sortingOrder, null);
  assert.equal(question.answers.blue.answer, null);
  assert.equal(question.answers.blue.sortingOrder, null);
  for (const answer of ['["A","A","C","D"]', '["A","B"]', '["A","B","C","unknown"]', "not json"]) {
    const invalid = sortingSource();
    invalid.rounds[0].teamAnswers.red.answers[0].data.answer = answer;
    assert.throws(() => normalizeRoomSource(invalid, "invalid"));
  }
  for (const correctOrder of [["A", "A", "C", "D"], ["A", "B"]]) {
    const invalid = sortingSource();
    invalid.rounds[0].answers[0].data.correctOrder = correctOrder;
    assert.throws(() => normalizeRoomSource(invalid, "invalid"));
  }
  for (const itemCount of [0, -1, 1, 1.5, Infinity]) {
    assert.throws(() => inferQuestionMaximum({ type: "sorting", itemCount } as StatsRoundScoring));
  }
});

test("public sorting serialization allowlists nested item stages and order evidence", () => {
  const question = normalizeRoomSource(sortingSource(), "sorting").rounds[0].questions[0];
  const dirty = { ...question, sorting: { ...question.sorting!, secret: "PRIVATE", items: question.sorting!.items.map((item) => ({
    ...item, secret: "PRIVATE", stages: item.stages.map((stage) => ({ ...stage, storagePath: "PRIVATE" })),
  })) }, answers: { ...question.answers, red: { ...question.answers.red, user: "PRIVATE" } } };
  assert.equal(JSON.stringify(publicQuestion(dirty)).includes("PRIVATE"), false);
});

test("sorting history renders readable ordered items, media, and positional comparisons", () => {
  const snapshot = normalizeRoomSource(sortingSource(), "sorting"), question = snapshot.rounds[0].questions[0];
  const html = renderToStaticMarkup(createElement(SortingOrder, {
    sorting: question.sorting!, order: question.answers.blue.sortingOrder!,
    assets: Object.fromEntries(Object.entries(snapshot.assets).map(([id, value]) => [id, { filename: value.storagePath.split("/").at(-1)! }])),
    assetUrl: (id) => `/assets/${id}`, label: "Blue submitted order", compare: true,
  }));
  assert.ok(html.indexOf("Event A") < html.indexOf("<audio"));
  assert.ok(html.indexOf("<audio") < html.indexOf("Event B"));
  assert.ok(html.indexOf("Event B") < html.indexOf("Event D"));
  assert.match(html, /Position 1 · Correct position/);
  assert.match(html, /Position 2 · Correct position: 3/);
  assert.match(html, /Position 3 · Correct position: 2/);
  assert.match(html, /<audio/);
  assert.match(html, /<img/);
});
