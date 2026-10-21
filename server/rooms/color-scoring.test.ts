import assert from "node:assert/strict";
import { awardColorPoints, perceptionScore, gradeColorRound } from "./color-scoring";
import { database } from "./test-database";

assert.equal(perceptionScore("#4285F4", "#4285F4").perceptionScore, 10);
assert.equal(perceptionScore("#FFFFFF", "#000000").perceptionScore, 1.06);
assert.throws(() => perceptionScore("red", "#000000"));
assert.throws(() => perceptionScore("#000000", "red"));
// Dialed's scoring curve and hue adjustments, without its deterministic jitter.
for (const [answer, target, expected] of [
  ["#DC94F2", "#D5AEEB", 8.89],
  ["#4C7308", "#78781A", 7.98],
  ["#13686E", "#204744", 8.09],
  ["#FF0000", "#00FFFF", 1.43], // Opposite hues receive the full hue penalty.
  ["#808080", "#888888", 9.65], // Grays receive no hue adjustments.
  ["#FF0010", "#FF1000", 9.85], // Nearby hues across the 360-degree boundary.
  ["#887878", "#788888", 6.21], // Low saturation weakens the hue penalty.
] as const) {
  const result = perceptionScore(answer, target);
  assert.equal(result.perceptionScore, expected);
  assert.equal(perceptionScore(target, answer).perceptionScore, expected);
  assert.deepEqual(perceptionScore(answer, target), result);
}

assert.deepEqual(awardColorPoints({ a: 8.5, b: 8.499 }, { mode: "threshold", points: 2, threshold: 8.5 }), { a: 2, b: 0 });
assert.deepEqual(awardColorPoints({ a: 9, b: 8.96, c: 8 }, { mode: "closest", points: 1, tieTolerance: 0.05 }), { a: 0.5, b: 0.5, c: 0 });
assert.deepEqual(awardColorPoints({ a: 1, b: 1, c: 1 }, { mode: "closest", points: 1, tieTolerance: 0.05 }), { a: 1 / 3, b: 1 / 3, c: 1 / 3 });

async function main() {
  const { db, docs } = database();
  docs.set("rooms/demo/rounds/r1", { type: "color", state: "closed", gradingRequired: true, scoring: { mode: "closest" } });
  docs.set("rooms/demo/rounds/r1/questions/q1", { initialColor: "#4285F4" });
  docs.delete("rooms/demo/rounds/r1/questions/q2");
  docs.set("rooms/demo/rounds/r1/answers/q1", { answer: "#4285F4" });
  await gradeColorRound(db, "demo", "r1", "host");
  assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 0.5);
  assert.equal(docs.get("rooms/demo/teams/blue")?.scoreTotal, 0.5);
  assert.equal(docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q1")?.perceptionScore, 10);
  await gradeColorRound(db, "demo", "r1", "host");
  assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 0.5);
  await assert.rejects(gradeColorRound(db, "demo", "r1", "player"), /Forbidden/);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
