import assert from "node:assert/strict";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { parseTeamAnswer, type AnswerMutation } from "@/lib/answers";
import { getAwardShortcut, getIncorrectAwardShortcut, getAwardedPoints } from "@/lib/components/room/grading";
import { parseDraftPoints } from "@/app/[room]/team-score-breakdown";
import { parseRoundMeta } from "@/lib/hooks/use-room-rounds";
import { validateQuizFile } from "./validation";
import { createRoundDocumentData } from "./manifest";
import { parseAnswerSave, saveTeamAnswer } from "./answer-input";
import { current, database, redAnswer, blueAnswer } from "./test-database";
import { transitionPresentation } from "./presentation";

const packRound = { type: "text", title: "Wagers", allowWager: true, questions: [
  { prompt: { stages: [{ text: "Capital?" }] }, answer: { hint: "Paris", stages: [{ text: "Paris" }] } },
] };
assert.deepEqual(validateAgainstQuizSchema([packRound], schema), []);
const parsed = validateQuizFile(JSON.stringify([packRound]));
assert.ok(typeof parsed !== "string");
assert.equal(createRoundDocumentData(parsed[0]).allowWager, true);
assert.equal(parseRoundMeta("r1", createRoundDocumentData(parsed[0]), 0)?.allowWager, true);
assert.equal(parseRoundMeta("r1", { type: "text" }, 0)?.allowWager, false);
for (const invalid of [{ ...packRound, allowWager: "true" }, { ...packRound, type: "image" },
  { ...packRound, type: "multi-step" }, { ...packRound, type: "color" }]) {
  assert.ok(validateAgainstQuizSchema([invalid], schema).length);
  assert.equal(typeof validateQuizFile(JSON.stringify([invalid])), "string");
}
assert.throws(() => parseTeamAnswer({ answer: "", locked: false, user: null, wagered: "true" }));
for (const raw of [{ teamId: "red", wagered: 2 }, { teamId: "red", wagered: true, answer: "A" },
  { teamId: "red", wagered: true, locked: false }]) assert.throws(() => parseAnswerSave(raw));

const round = { type: "text", allowWager: true };
for (const wagered of [true, false]) {
  assert.equal(getAwardShortcut({ wagered }, round), wagered ? 2 : 1);
  assert.equal(getIncorrectAwardShortcut({ wagered }, round), wagered ? -2 : 0);
}
assert.equal(getAwardedPoints(-2, round), -2);
assert.equal(parseDraftPoints("-2", round), -2);
assert.equal(getAwardedPoints(-2, { type: "text", allowWager: false }), 0);
assert.equal(getIncorrectAwardShortcut({ wagered: true }, { type: "image", allowWager: true }), 0);

async function main() {
  const { db, docs } = database("text");
  docs.get("rooms/demo/rounds/r1")!.allowWager = true;
  const save = (mutation: AnswerMutation, uid = "player", question = "q1") =>
    saveTeamAnswer(db, "demo", "r1", question, uid, parseAnswerSave({ teamId: "red", ...mutation }));
  await save({ locked: true });
  await save({ wagered: true });
  assert.equal(docs.get(redAnswer)?.locked, true);
  assert.equal(docs.get(redAnswer)?.answer, "Paris");
  await save({ wagered: false }, "teammate");
  assert.equal(parseTeamAnswer(docs.get(redAnswer)!).wagered, false);
  await save({ wagered: true }, "teammate");
  assert.equal(parseTeamAnswer(docs.get(redAnswer)!).wagered, true);
  await save({ locked: false });
  await save({ answer: "" });
  assert.equal(docs.get(redAnswer)?.wagered, true);
  await save({ locked: true });
  // A wager alone creates an answer document, including for an untouched blank answer.
  await save({ wagered: true }, "player", "q2");
  await assert.rejects(save({ wagered: false }, "outsider"), /Team changed/);
  await transitionPresentation(db, "demo", "host", current, { ...current, question: null }, { closeRound: "r1" });
  await assert.rejects(save({ wagered: false }), /Round is not accepting/);
  for (const question of ["q1", "q2"]) {
    const saved = docs.get(`rooms/demo/rounds/r1/teamAnswers/red/answers/${question}`)!;
    assert.equal(saved.answer, "");
    assert.equal(saved.wagered, true);
    assert.equal(saved.awardedPoints, -2);
    assert.equal(getAwardShortcut(saved, round), 2);
  }
  const blue = docs.get("rooms/demo/rounds/r1/teamAnswers/blue/answers/q1")!;
  assert.equal(blue.awardedPoints, undefined);
  assert.equal(docs.get(blueAnswer)?.wagered, undefined);
  for (const type of ["text", "multi-step"] as const) {
    const disabled = database(type);
    await assert.rejects(saveTeamAnswer(disabled.db, "demo", "r1", "q1", "player",
      parseAnswerSave({ teamId: "red", wagered: true })), /Wagers are not enabled/);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
