import assert from "node:assert/strict";
import test from "node:test";
import type { PercentageComponent, StatsAppearance, StatsHistoryResult, StatsMapping, StatsRoundScoring } from "@/types/stats";
import { calculateOutcomes, calculatePercentage, canonicalPlayerMappings, inferQuestionMaximum, median, reconcileScore, summarizePlayerResults } from "./metrics";

const component = (changes: Partial<PercentageComponent> = {}): PercentageComponent => ({
  gameId: "g1", roundId: "r1", questionId: "q1", teamId: "red", earned: 1,
  maximum: { points: 1, provenance: "configured" }, closestPool: false, reconciled: true, provisional: false, ...changes,
});
const history = (changes: Partial<StatsHistoryResult> = {}): StatsHistoryResult => ({
  gameId: "g1", completedAt: null, outcome: "win", teamPoints: 10, provisional: false, ...changes,
});

test("maxima preserve every supported scoring model and explicit historical uncertainty", () => {
  const cases: Array<[StatsRoundScoring, number]> = [
    [{ type: "text", allowWager: false }, 1], [{ type: "text", allowWager: true }, 2],
    [{ type: "image" }, 1], [{ type: "multi-step", pointsPerStep: [5, 3, -2] }, 5],
    [{ type: "multi-step", pointsPerStep: [-3, -1] }, 0],
    [{ type: "color", scoring: { mode: "threshold", points: 2, threshold: 8.5 } }, 2],
    [{ type: "color", scoring: { mode: "closest", points: 1.5, tieTolerance: 0.05 } }, 1.5],
  ];
  for (const [scoring, expected] of cases) {
    assert.deepEqual(inferQuestionMaximum(scoring), { points: expected, provenance: "configured" });
    assert.deepEqual(inferQuestionMaximum(scoring, 0), { points: 0, provenance: "admin" });
    assert.deepEqual(inferQuestionMaximum(scoring, 3.5), { points: 3.5, provenance: "admin" });
  }
  for (const scoring of [{ type: "text", allowWager: null }, { type: "multi-step", pointsPerStep: null }, { type: "color", scoring: null }] satisfies StatsRoundScoring[]) {
    assert.deepEqual(inferQuestionMaximum(scoring), { points: 1, provenance: "default-unverified" });
  }
});

test("malformed configuration is refused rather than defaulted", () => {
  for (const scoring of [
    { type: "unknown" }, { type: "text", allowWager: "yes" },
    { type: "multi-step", pointsPerStep: [] }, { type: "multi-step", pointsPerStep: [NaN] },
    { type: "color", scoring: { mode: "closest", points: -1, tieTolerance: 0.05 } },
    { type: "color", scoring: { mode: "threshold", points: 1, threshold: 11 } },
    { type: "color", scoring: { mode: "invalid", points: 1 } },
  ]) assert.throws(() => inferQuestionMaximum(scoring as StatsRoundScoring));
  for (const maximum of [-1, NaN, Infinity]) assert.throws(() => inferQuestionMaximum({ type: "image" }, maximum));
});

test("only shared first places tie; competition rank and exact signed scores are preserved", () => {
  const results = (scores: Array<number | null>) => calculateOutcomes(scores.map((score, index) => ({ id: String(index), name: String(index), score })));
  assert.deepEqual(results([10, 10, 5, 5]).map(({ rank, outcome }) => [rank, outcome]), [[1, "tie"], [1, "tie"], [3, "loss"], [3, "loss"]]);
  assert.deepEqual(results([-0.5, -1, -1]).map(({ rank, outcome }) => [rank, outcome]), [[1, "win"], [2, "loss"], [2, "loss"]]);
  assert.deepEqual(results([1 / 3, 1 / 3 + 1e-12]).map(({ outcome }) => outcome), ["loss", "win"]);
  for (const scores of [[], [0], [10, null]]) assert.ok(results(scores).every((team) => team.outcome === "unavailable" && team.rank === null));
  assert.throws(() => results([NaN, 0]));
  assert.throws(() => calculateOutcomes([{ id: "a", name: "A", score: 1 }, { id: "a", name: "A", score: 0 }]));
});

test("percentages pair exactly the same question inputs and disclose omitted inputs", () => {
  const percentage = calculatePercentage([
    component({ earned: -2, maximum: { points: 2, provenance: "configured" }, provisional: true }),
    component({ questionId: "q2", earned: 3, maximum: { points: 5, provenance: "configured" } }),
    component({ questionId: "q3", earned: 100, maximum: { points: 1, provenance: "default-unverified" } }),
    component({ questionId: "q4", earned: null }),
  ]);
  assert.equal(percentage.numerator, 1);
  assert.equal(percentage.denominator, 7);
  assert.equal(percentage.value, 1 / 7);
  assert.deepEqual(percentage.coverage, {
    eligibleQuestionTeams: 2, totalQuestionTeams: 4, eligibleQuestions: 2, totalQuestions: 4,
    eligibleTeams: 1, totalTeams: 1, eligibleGames: 1, totalGames: 1, provisionalGames: 1,
    excluded: { "unverified-maximum": 1, "missing-award": 1 },
  });
  assert.equal(calculatePercentage([component({ earned: -2 })]).value, -2);
  for (const changes of [
    { earned: null }, { maximum: { points: 0, provenance: "admin" as const } },
    { earned: 2 }, { reconciled: false },
  ]) assert.equal(calculatePercentage([component(changes)]).value, null);
  assert.equal(calculatePercentage([]).value, null);
  assert.throws(() => calculatePercentage([component({ earned: NaN })]));
  assert.throws(() => calculatePercentage([component(), component()]));
});

test("host difficulty excludes closest pools and rejects an incomplete game's comparison population", () => {
  const parts = [
    component({ earned: 0.5 }), component({ teamId: "blue", earned: 0 }),
    component({ questionId: "color", earned: 0.5, closestPool: true }),
    component({ questionId: "color", teamId: "blue", earned: 0.5, closestPool: true }),
  ];
  const difficulty = calculatePercentage(parts, "difficulty");
  assert.equal(difficulty.value, 0.25);
  assert.equal(difficulty.coverage.excluded["closest-pool"], 2);
  assert.equal(calculatePercentage(parts).value, 0.375);
  const incomplete = calculatePercentage([...parts, component({ questionId: "missing", earned: null })], "difficulty");
  assert.equal(incomplete.value, null);
  assert.equal(incomplete.coverage.excluded["incomplete-game"], 2);
  assert.equal(calculatePercentage([...parts, component({ gameId: "other", earned: null })], "difficulty").value, 0.25);
  const missingMode = calculatePercentage([component({ closestPool: null })], "difficulty");
  assert.equal(missingMode.value, null);
  assert.equal(missingMode.coverage.excluded["unknown-scoring"], 1);
});

test("question identities and coverage remain distinct across games, rounds, and teams", () => {
  const percentage = calculatePercentage([
    component(), component({ teamId: "blue" }), component({ roundId: "r2" }), component({ gameId: "g2" }),
  ]);
  assert.equal(percentage.coverage.eligibleQuestions, 3);
  assert.equal(percentage.coverage.eligibleTeams, 3);
  assert.equal(percentage.coverage.eligibleGames, 2);
});

test("score reconciliation tolerates split-point arithmetic without concealing score adjustments", () => {
  assert.equal(reconcileScore(1, [1 / 3, 1 / 3, 1 / 3]).status, "reconciled");
  assert.equal(reconcileScore(0.3, [0.1, 0.2]).status, "reconciled");
  assert.deepEqual(reconcileScore(8, [5, 1]), { status: "mismatch", difference: 2 });
  assert.equal(reconcileScore(-1, [-2, 1]).status, "reconciled");
  for (const [score, parts] of [[null, [1]], [0, []], [1, [null]]] as const) assert.equal(reconcileScore(score, [...parts]).status, "unavailable");
  assert.throws(() => reconcileScore(Infinity, [0]));
});

test("player participation totals count provisional results but keep unknown outcomes and points unavailable", () => {
  const summary = summarizePlayerResults([
    history(), history({ gameId: "g2", outcome: "tie", teamPoints: -2, provisional: true }),
    history({ gameId: "g3", outcome: "loss", teamPoints: 0 }),
  ]);
  assert.equal(summary.winRate, 1 / 3);
  assert.equal(summary.teamPoints, 8);
  assert.equal(summary.provisionalGames, 1);
  const unknown = summarizePlayerResults([history({ outcome: "unavailable", teamPoints: null })]);
  assert.equal(unknown.gamesPlayed, 1);
  assert.equal(unknown.resultsUnavailable, 1);
  assert.equal(unknown.winRate, null);
  assert.equal(unknown.teamPoints, null);
  assert.equal(unknown.averageTeamPoints, null);
  assert.equal(summarizePlayerResults([]).winRate, null);
  assert.throws(() => summarizePlayerResults([history(), history()]));
});

test("explicit same-team duplicates count once and never merge by name", () => {
  const appearances: StatsAppearance[] = [
    { id: "a", alias: "Alex", teamId: "red" }, { id: "b", alias: "Alexander", teamId: "red" },
    { id: "c", alias: "Alex", teamId: "blue" }, { id: "d", alias: "Observer", teamId: null },
  ];
  const mappings: Record<string, StatsMapping> = {
    a: { personId: "person-1", duplicateOf: null }, b: { personId: "person-1", duplicateOf: "a" },
    d: { personId: "person-2", duplicateOf: null },
  };
  assert.deepEqual(canonicalPlayerMappings(appearances, mappings), [
    { personId: "person-1", appearanceId: "a", teamId: "red", aliases: ["Alex", "Alexander"] },
  ]);
  assert.throws(() => canonicalPlayerMappings(appearances, { ...mappings, b: { personId: "person-1", duplicateOf: null } }));
  assert.throws(() => canonicalPlayerMappings(appearances, { ...mappings, c: { personId: "person-1", duplicateOf: "a" } }));
  assert.throws(() => canonicalPlayerMappings(appearances, { ...mappings, a: { personId: "person-1", duplicateOf: "b" } }));
  assert.throws(() => canonicalPlayerMappings(appearances, { unknown: { personId: "p", duplicateOf: null } }));
  assert.throws(() => canonicalPlayerMappings(appearances, { a: { personId: null, duplicateOf: "b" } }));
});

test("median preserves signed/fractional inputs and unknown populations", () => {
  assert.equal(median([]), null);
  assert.equal(median([0.25, -1, 0.5]), 0.25);
  assert.equal(median([0, 0.5]), 0.25);
  assert.throws(() => median([NaN]));
});
