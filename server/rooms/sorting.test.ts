import assert from "node:assert/strict";
import { parseAnswerSave, saveTeamAnswer } from "./answer-input";
import { transitionPresentation } from "./presentation";
import { gradeSortingRound, scoreSortingOrder } from "./sorting";
import { current, database } from "./test-database";

const correctOrder = ["a", "b", "c", "d"];
const roundPath = "rooms/demo/rounds/sorting";
const questionId = "question-1";
const inputPath = (team: string) => `rooms/demo/teams/${team}/rounds/sorting/answers/${questionId}`;
const frozenPath = (team: string) => `${roundPath}/teamAnswers/${team}/answers/${questionId}`;

function fixture() {
  const fixture = database("text");
  fixture.docs.set(roundPath, { type: "sorting", state: "scheduled", activeWindow: { startedAt: null, endedAt: null }, gradingRequired: false });
  fixture.docs.set(`${roundPath}/questions/${questionId}`, {
    order: 0, text: "Earliest to latest", stages: [{ text: "Earliest to latest" }],
    items: correctOrder.map((id) => ({ id, stages: [{ text: id.toUpperCase() }] })),
  });
  fixture.docs.set(`${roundPath}/answers/${questionId}`, { correctOrder });
  fixture.docs.set("rooms/demo/rounds/r2/questions/q1", { order: 0, stages: [{ text: "Foreground two" }] });
  return fixture;
}

async function main() {
  for (const [order, expected] of [
    [["a", "b", "c", "d"], 4],
    [["a", "c", "b", "d"], 2],
    [["b", "a", "d", "c"], 0],
  ] as const) assert.equal(scoreSortingOrder(order, correctOrder), expected);
  for (const malformed of [["a"], ["a", "a", "c", "d"], ["a", "b", "c", "unknown"]]) {
    assert.throws(() => scoreSortingOrder(malformed, correctOrder));
  }

  {
    const { db, docs } = fixture();
    const save = (uid: string, teamId: string, order: unknown) => saveTeamAnswer(db, "demo", "sorting", questionId, uid,
      parseAnswerSave({ teamId, answer: JSON.stringify(order) }));
    await assert.rejects(save("player", "red", correctOrder), /Round/);
    await assert.rejects(transitionPresentation(db, "demo", "player", current, current, { activateRound: "sorting" }), /Forbidden/);
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    assert.deepEqual(docs.get("rooms/demo")?.presenting, current);
    assert.equal(docs.get(roundPath)?.state, "active");
    const openedWindow = docs.get(roundPath)?.activeWindow as { startedAt: unknown };
    assert.ok(openedWindow.startedAt);
    await assert.rejects(transitionPresentation(db, "demo", "host", current,
      { ...current, round: "sorting", question: questionId, withAnswer: true }));
    await save("player", "red", correctOrder);
    await save("outsider", "blue", ["b", "a", "d", "c"]);
    assert.equal(docs.get(inputPath("red"))?.answer, JSON.stringify(correctOrder));
    await save("teammate", "red", ["a", "c", "b", "d"]);
    assert.equal(docs.get(inputPath("red"))?.user, "teammate");
    assert.equal(docs.get(inputPath("blue"))?.answer, '["b","a","d","c"]');
    for (const malformed of [[], ["a", "b", "c"], ["a", "b", "c", "c"], ["a", "b", "c", "unknown"], { a: 1 }, null]) {
      await assert.rejects(save("player", "red", malformed));
    }
    await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", answer: "not JSON" })));
    await assert.rejects(save("outsider", "red", correctOrder), /Team changed/);
    await assert.rejects(save("missing", "red", correctOrder), /Join a team/);
    await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", locked: true })));
    await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", wagered: true })));
    await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", answer: JSON.stringify(correctOrder), expectedStep: 0 })));
    await assert.rejects(gradeSortingRound(db, "demo", "sorting", "host"));

    const foregroundTwo = { ...current, round: "r2", question: "q1" };
    await transitionPresentation(db, "demo", "host", current, foregroundTwo, { activateRound: "r2" });
    assert.equal(docs.get(roundPath)?.state, "active");
    assert.equal(docs.get(inputPath("red"))?.answer, '["a","c","b","d"]');
    await save("player", "red", correctOrder);
    await transitionPresentation(db, "demo", "host", foregroundTwo, foregroundTwo, { closeRound: "sorting" });
    assert.deepEqual(docs.get("rooms/demo")?.presenting, foregroundTwo);
    assert.equal(docs.get("rooms/demo/rounds/r2")?.state, "active");
    assert.equal(docs.get(roundPath)?.state, "closed");
    assert.equal((docs.get(roundPath)?.activeWindow as { startedAt: unknown }).startedAt, openedWindow.startedAt);
    assert.equal(docs.get(frozenPath("red"))?.answer, JSON.stringify(correctOrder));
    assert.equal(docs.get(frozenPath("blue"))?.answer, '["b","a","d","c"]');
    await assert.rejects(save("teammate", "red", ["a", "c", "b", "d"]), /Round/);
    await assert.rejects(transitionPresentation(db, "demo", "host", foregroundTwo, foregroundTwo, { closeRound: "sorting" }));
    await assert.rejects(gradeSortingRound(db, "demo", "sorting", "player"), /Forbidden/);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get(frozenPath("red"))?.awardedPoints, 4);
    assert.equal(docs.get(frozenPath("blue"))?.awardedPoints, 0);
    assert.equal(docs.get("rooms/demo/teams/red/scores/sorting")?.score, 4);
    assert.equal(docs.get("rooms/demo/teams/blue/scores/sorting")?.score, 0);
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 4);
    assert.equal(docs.get(`${roundPath}/teamAnswers/red`)?.graded, true);
    assert.equal(docs.get(roundPath)?.gradingRequired, false);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 4);
    await transitionPresentation(db, "demo", "host", foregroundTwo,
      { ...foregroundTwo, round: "sorting", question: questionId, withAnswer: true });
  }
  {
    const { db, docs } = fixture();
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    docs.set(inputPath("red"), { answer: '["a","b","c","c"]', user: "player" });
    await assert.rejects(transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" }));
    assert.equal(docs.get(roundPath)?.state, "active");
    assert.equal(docs.has(frozenPath("red")), false);
    assert.equal(docs.has(frozenPath("blue")), false);
    docs.delete(inputPath("red"));
    docs.set("rooms/demo", { state: "ended", presenting: current });
    await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", answer: JSON.stringify(correctOrder) })), /Round/);
  }
  {
    const { db, docs } = fixture();
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    await saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", answer: '["a","c","b","d"]' }));
    await transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" });
    assert.equal(docs.get(frozenPath("blue"))?.answer, "");
    docs.set("rooms/demo/teams/red", { name: "Red", scoreTotal: 11 });
    docs.set("rooms/demo/teams/red/scores/sorting", { score: 1 });
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get(frozenPath("red"))?.awardedPoints, 2);
    assert.equal(docs.get(frozenPath("blue"))?.awardedPoints, 0);
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 12);
    assert.equal(docs.get("rooms/demo/teams/red/scores/sorting")?.score, 2);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 12);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
