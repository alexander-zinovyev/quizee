import assert from "node:assert/strict";
import { isAnswerCommitted, recordedAnswer } from "@/lib/answers";
import { leavesStep, parsePresentation, transitionPresentation } from "./presentation";
import { current, database, redAnswer, blueAnswer } from "./test-database";

const next = { ...current, promptPage: 1 };
async function main() {
  for (const input of [null, { ...current, promptPage: -1 }, { ...current, round: "r1/path" }]) assert.throws(() => parsePresentation(input));
  assert.equal(leavesStep(current, current), false);
  assert.equal(leavesStep(current, { ...current, answerPage: 1 }), false);
  for (const destination of [next, { ...current, question: "q2" }, { ...current, question: null }, { ...current, withAnswer: true }]) {
    const { db, docs } = database();
    docs.set(redAnswer, { ...docs.get(redAnswer), locked: true });
    await transitionPresentation(db, "demo", "host", current, destination);
    assert.deepEqual(recordedAnswer(docs.get(redAnswer)!, "multi-step"), { answer: "Paris", step: 0 });
    assert.equal(docs.get(redAnswer)?.locked, true);
    assert.deepEqual(docs.get(blueAnswer)?.attempts, []);
    assert.equal(docs.get("rooms/demo/rounds/r1/questions/q1")?.finalizedStep, destination.withAnswer ? 2 : 0);
    assert.equal(docs.get(redAnswer)?.eligiblePoints, undefined);
    assert.equal(docs.get(redAnswer)?.submittedStep, undefined);
  }
  {
    const { db, docs } = database("multi-step", false);
    await transitionPresentation(db, "demo", "host", current, next);
    assert.equal(docs.get(redAnswer)?.locked, false);
    assert.ok(isAnswerCommitted(false, docs.get(redAnswer)!.attempts as []));
  }
  {
    const { db, docs } = database();
    await transitionPresentation(db, "demo", "host", current, next);
    docs.set(redAnswer, { ...docs.get(redAnswer), answer: "Paris" });
    await transitionPresentation(db, "demo", "host", next, { ...next, promptPage: 2 });
    assert.equal((docs.get(redAnswer)?.attempts as unknown[]).length, 1);
    docs.set(redAnswer, { ...docs.get(redAnswer), answer: "London" });
    await transitionPresentation(db, "demo", "host", { ...next, promptPage: 2 }, { ...current, question: null }, { closeRound: "r1" });
    const graded = docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q1")!;
    assert.deepEqual(recordedAnswer(graded, "multi-step"), { answer: "London", step: 2 });
    assert.deepEqual(Object.keys(graded), ["attempts"]);
    assert.equal((graded.attempts as unknown[]).length, 2);
    assert.deepEqual(docs.get("rooms/demo/rounds/r1/teamAnswers/blue/answers/q1"), { attempts: [] });
    assert.equal(docs.get("rooms/demo/rounds/r1")?.state, "closed");
    assert.equal((docs.get("rooms/demo/rounds/r1")?.activeWindow as { startedAt: string }).startedAt, "start");
  }
  {
    const { db, docs } = database("text");
    docs.set(redAnswer, { answer: " Saved text ", locked: false, user: "player" });
    await transitionPresentation(db, "demo", "host", current, next);
    assert.equal(docs.get(redAnswer)?.attempts, undefined);
    await transitionPresentation(db, "demo", "host", next, { ...current, question: null }, { closeRound: "r1" });
    assert.deepEqual(docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q1"), { answer: "Saved text", user: "player" });
    assert.equal(docs.get("rooms/demo/rounds/r1")?.state, "closed");
  }
  {
    const { db, docs } = database();
    await transitionPresentation(db, "demo", "host", current, { ...current, round: "r2", question: null }, { activateRound: "r2" });
    assert.deepEqual(recordedAnswer(docs.get(redAnswer)!, "multi-step"), { answer: "Paris", step: 0 });
    assert.equal(docs.get("rooms/demo/rounds/r2")?.state, "active");
  }
  {
    const { db, docs } = database();
    await transitionPresentation(db, "demo", "host", current, next);
    await transitionPresentation(db, "demo", "host", next, current);
    await transitionPresentation(db, "demo", "host", current, next);
    assert.equal((docs.get(redAnswer)?.attempts as unknown[]).length, 1);
    await transitionPresentation(db, "demo", "host", next, current);
    await transitionPresentation(db, "demo", "host", current, { ...current, withAnswer: true });
    assert.equal(docs.get("rooms/demo/rounds/r1/questions/q1")?.finalizedStep, 2);
  }
  for (const [uid, expected, destination] of [
    ["player", current, next], ["host", next, current], ["host", current, { ...next, promptPage: 100 }],
  ] as const) {
    const { db, docs } = database();
    await assert.rejects(transitionPresentation(db, "demo", uid, expected, destination));
    assert.deepEqual(docs.get(redAnswer)?.attempts, []);
    assert.deepEqual(docs.get("rooms/demo")?.presenting, current);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
