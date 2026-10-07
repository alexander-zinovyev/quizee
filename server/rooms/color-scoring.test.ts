import assert from "node:assert/strict";
import { awardColorPoints, perceptionScore, gradeColorRound } from "./color-scoring";
import { database } from "./test-database";

assert.equal(perceptionScore("#4285F4", "#4285F4").perceptionScore, 10);
assert.ok(perceptionScore("#FFFFFF", "#000000").perceptionScore < 1);
assert.throws(() => perceptionScore("red", "#000000"));
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
