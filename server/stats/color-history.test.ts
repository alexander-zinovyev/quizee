import assert from "node:assert/strict";
import test from "node:test";
import type { StatsReview } from "@/types/stats";
import { inferQuestionMaximum } from "./metrics";
import { projectGame } from "./projection";
import { publicMetrics, publicQuestion } from "./serializers";
import { snapshotDocuments } from "./snapshots";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";

test("proportional color history retains fractional awards, standings, and independent one-point maxima", () => {
  const source = roomSourceFixture(4, 4);
  const round = source.rounds[3];
  source.rounds = [round];
  round.data.scoring = { mode: "proportional" };
  const scores = { red: [0, 8.5, 8.57, 10], blue: [0, 8.5, 8.57, 8.57] };
  for (const team of source.teams) {
    round.teamAnswers[team.id].answers.forEach((answer, index) => {
      const score = scores[team.id as keyof typeof scores][index];
      answer.data = { ...answer.data, perceptionScore: score, awardedPoints: score / 10 };
    });
    const total = round.teamAnswers[team.id].answers.reduce((sum, answer) => sum + Number(answer.data.awardedPoints), 0);
    team.data.scoreTotal = total;
    team.scores = [{ id: round.id, data: { score: total } }];
  }
  const snapshot = normalizeRoomSource(source, "proportional");
  const review: StatsReview = { hostPersonId: null, mappings: Object.fromEntries(snapshot.appearances.map((appearance) =>
    [appearance.id, { personId: appearance.id, duplicateOf: null }])), maxima: {}, completedAt: null, packLabel: null };
  const projection = projectGame(snapshot, review, 1);
  const metrics = publicMetrics(projection.metrics), normalized = snapshot.rounds[0];
  assert.deepEqual(inferQuestionMaximum(normalized.scoring), { points: 1, provenance: "configured" });
  assert.deepEqual(normalized.questions.map((question) => publicQuestion(question).answers.red.awardedPoints), [0, 0.85, 0.857, 1]);
  assert.deepEqual(normalized.questions.map((question) => question.answers.red.perceptionScore), scores.red);
  assert.equal(metrics.results.find((team) => team.id === "red")!.outcome, "win");
  assert.equal(metrics.results.find((team) => team.id === "red")!.score, 0.85 + 0.857 + 1);
  assert.equal(metrics.rounds[0].teams.red.score, 0.85 + 0.857 + 1);
  assert.equal(metrics.rounds[0].teams.red.reconciliation.status, "reconciled");
  assert.equal(metrics.rounds[0].teams.red.percentage.denominator, 4);
  assert.equal(metrics.percentage.denominator, 8);
  assert.equal(metrics.percentage.numerator, source.teams.reduce((sum, team) => sum + Number(team.data.scoreTotal), 0));
  assert.equal(metrics.poolPercentage.denominator, 0);
  assert.deepEqual(metrics.percentage.coverage.excluded, {});
  for (const player of projection.players.values()) {
    assert.equal(player.teamPoints, source.teams.find((team) => team.id === player.teamId)!.data.scoreTotal);
    assert.equal(player.percentage.denominator, 4);
  }
  const saved = snapshotDocuments(snapshot);
  assert.equal(saved.find((document) => document.path.endsWith(`/questions/question-3/answers/red`))!.data.awardedPoints, 0.857);
});
