import assert from "node:assert/strict";
import { parseAnswerSave, saveTeamAnswer } from "./answer-input";
import { current, database, redAnswer } from "./test-database";
import { transitionPresentation } from "./presentation";
import { recordedAnswer } from "@/lib/answers";

async function main() {
  for (const input of [null, {}, { teamId: "red", answer: "A", locked: false },
    { teamId: "red", answer: "A", user: "forged" }, { teamId: "red", answer: "A", eligiblePoints: 999 },
    { teamId: "red", answer: "A", attempts: [] }, { teamId: "red", locked: "true" },
    { teamId: "red", answer: "A", expectedStep: -1 }]) {
    assert.throws(() => parseAnswerSave(input));
  }
  for (const type of ["text", "multi-step"] as const) {
    const { db, docs } = database(type);
    const expectedStep = type === "multi-step" ? 0 : undefined;
    const save = (uid: string, mutation: { answer: string } | { locked: boolean }) => saveTeamAnswer(db, "demo", "r1", "q1", uid,
      { teamId: "red", expectedStep, mutation });
    await save("player", { answer: " Albert " });
    assert.equal(docs.get(redAnswer)?.answer, " Albert ");
    await save("teammate", { answer: "Einstein" });
    assert.equal(docs.get(redAnswer)?.user, "teammate");
    await save("player", { locked: true });
    assert.equal(docs.get(redAnswer)?.answer, "Einstein");
    await assert.rejects(save("teammate", { answer: "Locked edit" }), /Unlock/);
    await save("teammate", { locked: false });
    await save("teammate", { answer: "Paris" });
    await assert.rejects(save("outsider", { answer: "Foreign team" }), /Team changed/);
    await assert.rejects(save("missing", { answer: "No member" }), /Join a team/);
    await assert.rejects(saveTeamAnswer(db, "demo", "r1", "missing", "player",
      { teamId: "red", expectedStep, mutation: { answer: "Invalid question" } }), /not found/);
    const next = type === "multi-step" ? { ...current, promptPage: 1 } : { ...current, question: null };
    await transitionPresentation(db, "demo", "host", current, next,
      type === "text" ? { closeRound: "r1" } : {});
    await assert.rejects(save("player", { answer: "Late write" }), type === "multi-step" ? /Step/ : /Round/);
    if (type === "text") {
      assert.deepEqual(docs.get("rooms/demo/rounds/r1/teamAnswers/red/answers/q1"), { answer: "Paris", user: "teammate" });
    } else {
      assert.deepEqual(recordedAnswer(docs.get(redAnswer)!, type), { answer: "Paris", step: 0 });
      await saveTeamAnswer(db, "demo", "r1", "q1", "player", { teamId: "red", expectedStep: 1, mutation: { answer: "London" } });
      assert.deepEqual(recordedAnswer(docs.get(redAnswer)!, type), { answer: "Paris", step: 0 });
    }
  }
  {
    const { db, docs } = database("multi-step", false);
    await transitionPresentation(db, "demo", "host", current, { ...current, promptPage: 1 });
    assert.equal(docs.get(redAnswer)?.locked, false);
    await assert.rejects(saveTeamAnswer(db, "demo", "r1", "q1", "player",
      { teamId: "red", expectedStep: 1, mutation: { locked: false } }), /permanently locked/);
  }
  {
    const { db } = database();
    await assert.rejects(saveTeamAnswer(db, "demo", "r1", "q1", "player",
      { teamId: "red", expectedStep: 1, mutation: { answer: "Future step" } }), /Step/);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
