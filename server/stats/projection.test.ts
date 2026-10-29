import assert from "node:assert/strict";
import test from "node:test";
import type { StatsReview } from "@/types/stats";
import { hostSummary, playerSummary, replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { projectGame } from "./projection";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";

function fixture() {
  const snapshot = normalizeRoomSource(roomSourceFixture(), "s1");
  const review: StatsReview = { hostPersonId: "host", completedAt: null, packLabel: null, maxima: {},
    mappings: Object.fromEntries(snapshot.appearances.map((appearance) => [appearance.id, { personId: snapshot.sourceMembers[appearance.id], duplicateOf: null }])) };
  return { snapshot, review };
}

test("game/person projections use frozen scores, explicit mappings, and separate closest pools", () => {
  const { snapshot, review } = fixture();
  const projection = projectGame(snapshot, review, 2);
  assert.equal(projection.players.size, 6);
  assert.equal(projection.host!.personId, "host");
  const red = projection.players.get("red-uid-0")!;
  assert.equal(red.gameVersion, 2);
  assert.equal(red.outcome, "win");
  assert.equal(red.teamPoints, snapshot.teams.find((team) => team.id === "red")!.score);
  assert.equal(red.poolPercentage.value, 0.5);
  assert.equal(red.percentage.coverage.excluded["closest-pool"], 10);
  assert.equal(projection.metrics.difficulty.coverage.excluded["closest-pool"], 20);
  assert.equal(projection.host!.teamPercentages.length, 2);
  assert.equal(red.byRoundType["multi-step"].percentage.value, 1);
  assert.equal(projection.players.get("blue-uid-0")!.byRoundType["multi-step"].percentage.value, -0.4);
  assert.equal(projection.metrics.rounds[0].teams.red.answers.knownCorrectness, 0);
});

test("maxima edits change denominators without changing recorded awards, totals, or outcomes", () => {
  const { snapshot, review } = fixture();
  const original = projectGame(snapshot, review, 1);
  review.maxima["round-1"] = { "question-1": 5 };
  const changed = projectGame(snapshot, review, 2);
  assert.deepEqual(changed.metrics.results, original.metrics.results);
  assert.equal(changed.players.get("red-uid-0")!.teamPoints, original.players.get("red-uid-0")!.teamPoints);
  assert.equal(changed.players.get("red-uid-0")!.percentage.denominator, original.players.get("red-uid-0")!.percentage.denominator + 4);
  assert.equal(changed.players.get("red-uid-0")!.percentage.numerator, original.players.get("red-uid-0")!.percentage.numerator);
  assert.equal(snapshot.rounds[0].questions[0].answers.red.awardedPoints, 1);
});

test("partial mapping does not suppress a mapped player's participation", () => {
  const { snapshot, review } = fixture();
  const first = snapshot.appearances[0];
  review.mappings = { [first.id]: { personId: "one-person", duplicateOf: null } };
  const projection = projectGame(snapshot, review, 1);
  assert.equal(projection.players.size, 1);
  assert.equal(projection.summary.unresolvedAppearances, 5);
  assert.equal(projection.players.get("one-person")!.roster.length, 1);
});

test("incomplete grading is provisional and reconciliation problems exclude host comparisons", () => {
  const { snapshot, review } = fixture();
  snapshot.rounds[0].gradingIncomplete = true;
  const provisional = projectGame(snapshot, review, 1);
  assert.equal(provisional.host!.provisional, true);
  assert.equal(provisional.metrics.difficulty.coverage.provisionalGames, 1);
  snapshot.rounds[0].questions[0].answers.red.awardedPoints = null;
  const partial = projectGame(snapshot, review, 2);
  assert.equal(partial.host!.difficulty.value, null);
  assert.equal(partial.host!.teamPercentages.length, 0);
  assert.notEqual(partial.players.get("red-uid-0")!.percentage.value, null);
  snapshot.teams.find((team) => team.id === "red")!.score! += 10;
  const mismatch = projectGame(snapshot, review, 3);
  assert.ok(mismatch.metrics.warnings.some((warning) => warning.code === "final-score-mismatch"));
  assert.equal(mismatch.players.get("red-uid-0")!.percentage.value, null);
});

test("contribution replacement is reversible and duplicate desired contributions add nothing", () => {
  const { snapshot, review } = fixture();
  const projection = projectGame(snapshot, review, 1);
  const row = projection.players.get("red-uid-0")!, host = projection.host!;
  const aggregate = replacePlayerAggregate(null, null, row);
  assert.equal(playerSummary(aggregate.counters).gamesPlayed, 1);
  assert.equal(playerSummary(aggregate.counters).teamPoints, row.teamPoints);
  assert.deepEqual(replacePlayerAggregate(aggregate, row, row), aggregate);
  const removed = replacePlayerAggregate(aggregate, row, null);
  assert.equal(playerSummary(removed.counters).gamesPlayed, 0);
  assert.equal(playerSummary(removed.counters).teamPoints, null);
  assert.equal(playerSummary(removed.counters).winRate, null);
  const hosted = replaceHostAggregate(null, null, host);
  assert.equal(hostSummary(hosted.counters).gamesHosted, 1);
  assert.equal(hostSummary(replaceHostAggregate(hosted, host, null).counters).gamesHosted, 0);
});

test("unchanged fractional contributions do not introduce drift during other review edits", () => {
  const { snapshot, review } = fixture();
  const row = projectGame(snapshot, review, 1).players.get("red-uid-0")!;
  const existing = replacePlayerAggregate(null, null, { ...row, teamPoints: 0.3 });
  const unchanged = { ...row, teamPoints: 0.1 };
  assert.deepEqual(replacePlayerAggregate(existing, unchanged, unchanged), existing);
});

test("an empty contribution set has exactly empty totals before a later appearance", () => {
  const { snapshot, review } = fixture();
  const row = projectGame(snapshot, review, 1).players.get("red-uid-0")!;
  const a = { ...row, teamPoints: 0.1 }, b = { ...row, gameId: "other", teamPoints: 0.2 };
  let aggregate = replacePlayerAggregate(null, null, a);
  aggregate = replacePlayerAggregate(aggregate, null, b);
  aggregate = replacePlayerAggregate(aggregate, a, null);
  aggregate = replacePlayerAggregate(aggregate, b, null);
  assert.equal(aggregate.counters.teamPoints, 0);
  aggregate = replacePlayerAggregate(aggregate, null, { ...row, teamPoints: 1e-20 });
  assert.equal(playerSummary(aggregate.counters).teamPoints, 1e-20);
});
