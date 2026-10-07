import assert from "node:assert/strict";
import { database, current, redAnswer, blueAnswer } from "./test-database";
import { saveTeamAnswer, parseAnswerSave } from "./answer-input";
import { transitionPresentation } from "./presentation";

async function main() {
  const { db, docs } = database();
  docs.set("rooms/demo/rounds/r1", { type: "color", state: "active" });
  docs.set("rooms/demo/rounds/r1/questions/q1", { initialColor: "#123456" });
  docs.set("rooms/demo/rounds/r1/questions/q2", { initialColor: "#ABCDEF" });
  docs.delete(redAnswer); docs.delete(blueAnswer);
  await assert.rejects(saveTeamAnswer(db, "demo", "r1", "q1", "outsider", parseAnswerSave({ teamId: "red", answer: "#FFFFFF" })));
  await assert.rejects(saveTeamAnswer(db, "demo", "r1", "q1", "player", parseAnswerSave({ teamId: "red", answer: "red" })));
  await assert.rejects(transitionPresentation(db, "demo", "host", current, { ...current, withAnswer: true }), /End the color/);
  await saveTeamAnswer(db, "demo", "r1", "q1", "player", parseAnswerSave({ teamId: "red", answer: "#aabbcc" }));
  await transitionPresentation(db, "demo", "host", current, current, { closeRound: "r1" });
  assert.equal(docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q1")?.answer, "#AABBCC");
  assert.equal(docs.get("rooms/demo/rounds/r1/teamAnswers/blue/answers/q1")?.answer, "#123456");
  assert.equal(docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q2")?.answer, "#ABCDEF");
  await assert.rejects(saveTeamAnswer(db, "demo", "r1", "q1", "player", parseAnswerSave({ teamId: "red", answer: "#FFFFFF" })), /Round/);
  await transitionPresentation(db, "demo", "host", current, { ...current, withAnswer: true });
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
