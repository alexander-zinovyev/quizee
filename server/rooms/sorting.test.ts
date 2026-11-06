import assert from "node:assert/strict";
import { applySortingEdit, parseSortingEdit, parseSortingSnapshot, type SortingEdit } from "@/types/sorting";
import { parseAnswerSave, saveTeamAnswer } from "./answer-input";
import { parseSortingEditSave, saveSortingEdit } from "./sorting-edits";
import { transitionPresentation } from "./presentation";
import { gradeSortingRound, scoreSortingOrder } from "./sorting";
import { sortingQuestionIds } from "./sorting-questions";
import { current, database } from "./test-database";

const correctOrder = ["a", "b", "c", "d"];
const roundPath = "rooms/demo/rounds/sorting";
const questionId = "a";
const inputPath = (team: string) => `rooms/demo/teams/${team}/rounds/sorting`;
const frozenPath = (team: string) => `${roundPath}/teamAnswers/${team}`;
let editNumber = 0;
const edit = (itemId: string, anchorId: string, placement: SortingEdit["placement"] = "after"): SortingEdit => ({ id: `edit-${++editNumber}`, itemId, anchorId, placement });

function fixture() {
  const fixture = database("text");
  fixture.docs.set(roundPath, { type: "sorting", state: "scheduled", activeWindow: { startedAt: null, endedAt: null }, gradingRequired: false });
  correctOrder.forEach((id) => fixture.docs.set(`${roundPath}/questions/${id}`, { text: id.toUpperCase() }));
  fixture.docs.set(`${roundPath}/answers/order`, { correctOrder });
  fixture.docs.set("rooms/demo/rounds/r2/questions/q1", { order: 0, stages: [{ text: "Foreground two" }] });
  return fixture;
}

function helpers(value: ReturnType<typeof fixture>) {
  const { db, docs } = value;
  const save = async (uid: string, teamId: string, operation: SortingEdit) => {
    const ack = await saveSortingEdit(db, "demo", "sorting", uid, parseSortingEditSave({ teamId, edit: operation }));
    assert.ok("editId" in ack);
    return ack;
  };
  const order = (team: string) => parseSortingSnapshot(docs.get(inputPath(team)), correctOrder);
  const arrange = async (uid: string, team: string, desired: string[]) => {
    for (let index = 0; index < desired.length; index++) {
      const current = order(team).order;
      if (current[index] !== desired[index]) await save(uid, team, edit(desired[index], current[index], "before"));
    }
  };
  return { save, order, arrange };
}

async function main() {
  for (const malformed of [{}, { text: " " }, { media: {} }, { text: "A", stages: [] }, { text: "A", items: [] }, { text: "A", order: 0 }]) {
    const { db, docs } = fixture();
    docs.set(`${roundPath}/questions/a`, malformed);
    await assert.rejects(transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" }));
    assert.equal(docs.get(roundPath)?.state, "scheduled");
    assert.equal(docs.has(inputPath("red")), false, "Malformed content must not initialize team orders");
  }
  assert.deepEqual(sortingQuestionIds([
    { id: "a", data: () => ({ text: "A", media: null }) },
    { id: "b", data: () => ({ text: null, media: { storagePath: "media/b.png" } }) },
  ]), ["a", "b"]);
  {
    const { db, docs } = fixture();
    const { save, order } = helpers({ db, docs });
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    const before = order("red");
    docs.set(`${roundPath}/questions/a`, { stages: [{ text: "A" }] });
    await assert.rejects(save("player", "red", edit("a", "b")), /flat Stage/);
    assert.deepEqual(order("red"), before, "Malformed stored questions must not advance the revision");
    await assert.rejects(transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" }));
    assert.equal(docs.get(roundPath)?.state, "active");
    assert.equal(docs.has(frozenPath("red")), false);
  }
  for (const [order, expected] of [
    [["a", "b", "c", "d"], 4], [["a", "c", "b", "d"], 2], [["b", "a", "d", "c"], 0],
  ] as const) assert.equal(scoreSortingOrder(order, correctOrder), expected);
  assert.deepEqual(applySortingEdit(correctOrder, edit("a", "c")), ["b", "c", "a", "d"]);
  assert.deepEqual(applySortingEdit(correctOrder, edit("d", "b", "before")), ["a", "d", "b", "c"]);
  for (const malformed of [null, {}, { ...edit("a", "b"), id: "bad/id" }, { ...edit("a", "b"), id: "a".repeat(129) },
    { ...edit("a", "b"), placement: "between" }, { ...edit("a", "b"), itemId: "b" }, { ...edit("a", "b"), revision: 99 }]) {
    assert.throws(() => parseSortingEdit(malformed));
  }
  assert.throws(() => applySortingEdit(correctOrder, edit("unknown", "a")));
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0"]) assert.throws(() => parseSortingSnapshot({ order: correctOrder, revision }, correctOrder));
  for (const malformed of [["a"], ["a", "a", "c", "d"], ["a", "b", "c", "unknown"]]) assert.throws(() => parseSortingSnapshot({ order: malformed, revision: 0 }, correctOrder));
  for (const malformed of [null, [], {}, { teamId: "red", answer: "[]" },
    { teamId: "red/blue", edit: edit("a", "b") }, { teamId: "", edit: edit("a", "b") },
    { teamId: "red", edit: { ...edit("a", "b"), placement: "between" } }]) {
    assert.throws(() => parseSortingEditSave(malformed));
  }
  for (const extra of [{ answer: "[]" }, { expectedStep: 0 }, { locked: true }, { wagered: false }]) {
    assert.throws(() => parseSortingEditSave({ teamId: "red", edit: edit("a", "b"), ...extra }));
  }

  {
    const value = fixture(), { db, docs } = value, { save, order, arrange } = helpers(value);
    await assert.rejects(save("player", "red", edit("a", "b")), /Round/);
    await assert.rejects(transitionPresentation(db, "demo", "player", current, current, { activateRound: "sorting" }), /Forbidden/);
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    assert.deepEqual(docs.get("rooms/demo")?.presenting, current);
    assert.equal(docs.get(roundPath)?.state, "active");
    const starting = order("red");
    assert.equal(starting.revision, 0);
    assert.deepEqual([...starting.order].sort(), correctOrder);
    assert.deepEqual(order("blue"), starting);
    assert.deepEqual(docs.get(roundPath)?.startingOrder, starting.order);
    assert.equal(docs.get(inputPath("red"))?.user, null);
    assert.deepEqual(docs.get(`${roundPath}/questions/a`), { text: "A" });
    assert.deepEqual(docs.get(`${roundPath}/answers/order`), { correctOrder });
    assert.ok(!docs.has(`${roundPath}/questions/question-1`));
    await assert.rejects(transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" }), /activated/);
    await assert.rejects(transitionPresentation(db, "demo", "host", current,
      { ...current, round: "sorting", question: null, withAnswer: true }));
    await arrange("player", "red", correctOrder);
    const before = order("red").revision;
    const first = edit("a", "c");
    const firstAck = await save("player", "red", first);
    assert.deepEqual(firstAck, { editId: first.id, revision: before + 1 });
    assert.deepEqual(order("red").order, ["b", "c", "a", "d"]);
    await save("teammate", "red", edit("d", "b", "before"));
    assert.deepEqual(order("red").order, ["d", "b", "c", "a"]);
    assert.equal(docs.get(inputPath("red"))?.user, "teammate");
    assert.deepEqual(order("blue"), starting);
    await assert.rejects(save("outsider", "red", edit("a", "b")), /Team changed/);
    await assert.rejects(save("missing", "red", edit("a", "b")), /Join a team/);
    await assert.rejects(save("player", "red", edit("unknown", "b")), /unknown item/);
    await assert.rejects(save("player", "red", edit("a", "unknown")), /unknown item/);
    await assert.rejects(save("player", "red", { ...first, anchorId: "d" }), /already been used/);
    for (const mutation of [{ answer: JSON.stringify(correctOrder) }, { locked: true }, { wagered: true }]) {
      await assert.rejects(saveTeamAnswer(db, "demo", "sorting", questionId, "player", parseAnswerSave({ teamId: "red", ...mutation })), /relative edits|Wagers/);
    }
    assert.throws(() => parseAnswerSave({ teamId: "red", edit: edit("a", "b") }));
    await assert.rejects(saveSortingEdit(db, "demo", "r1", "player", parseSortingEditSave({ teamId: "red", edit: edit("a", "b") })), /sorting round/);
    await assert.rejects(gradeSortingRound(db, "demo", "sorting", "host"));

    const secondForeground = { ...current, round: "r2", question: "q1" };
    await transitionPresentation(db, "demo", "host", current, secondForeground, { activateRound: "r2" });
    await arrange("player", "red", correctOrder);
    await arrange("outsider", "blue", ["b", "a", "d", "c"]);
    const accepted = edit("a", "d");
    const acceptedAck = await save("player", "red", accepted);
    await save("teammate", "red", edit("a", "b", "before"));
    assert.deepEqual(await save("player", "red", accepted), acceptedAck);
    assert.deepEqual(order("red").order, correctOrder, "Replaying a receipt must not undo a teammate's newer move");
    const red = order("red"), blue = order("blue");
    await transitionPresentation(db, "demo", "host", secondForeground, secondForeground, { closeRound: "sorting" });
    assert.deepEqual(docs.get("rooms/demo")?.presenting, secondForeground);
    assert.equal(docs.get("rooms/demo/rounds/r2")?.state, "active");
    assert.deepEqual(parseSortingSnapshot(docs.get(frozenPath("red")), correctOrder), red);
    assert.equal(docs.get(frozenPath("red"))?.user, "teammate");
    assert.deepEqual(docs.get(frozenPath("blue"))?.order, blue.order);
    assert.equal(docs.get(frozenPath("red"))?.graded, false);
    await assert.rejects(save("teammate", "red", edit("a", "c")), (error: unknown) => (error as { code: string }).code === "round-closed");
    assert.deepEqual(await save("player", "red", accepted), acceptedAck, "An accepted edit can be acknowledged after closure");
    await assert.rejects(gradeSortingRound(db, "demo", "sorting", "player"), /Forbidden/);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get(frozenPath("red"))?.awardedPoints, 4);
    assert.equal(docs.get(frozenPath("blue"))?.awardedPoints, 0);
    assert.deepEqual(docs.get(frozenPath("red"))?.pointsByQuestion, { a: 1, b: 1, c: 1, d: 1 });
    assert.deepEqual(docs.get(frozenPath("blue"))?.pointsByQuestion, { a: 0, b: 0, c: 0, d: 0 });
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 4);
    assert.equal(docs.get(roundPath)?.gradingRequired, false);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 4);
    const answerPresentation = { ...secondForeground, round: "sorting", question: null, withAnswer: true };
    await transitionPresentation(db, "demo", "host", secondForeground, answerPresentation);
    assert.deepEqual(docs.get("rooms/demo")?.presenting, answerPresentation);
    await assert.rejects(transitionPresentation(db, "demo", "host", answerPresentation,
      { ...answerPresentation, question: "a" }), /whole round/);
  }
  {
    const value = fixture(), { db, docs } = value, { order } = helpers(value);
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    const initial = order("red");
    await transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" });
    await gradeSortingRound(db, "demo", "sorting", "host");
    const expected = scoreSortingOrder(initial.order, correctOrder);
    assert.equal(docs.get(frozenPath("red"))?.awardedPoints, expected);
    assert.equal(docs.get(frozenPath("blue"))?.awardedPoints, expected, "Untouched teams retain the shared initial submission");
  }
  {
    const { db, docs } = fixture();
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    docs.set(inputPath("red"), { order: ["a", "b", "c", "c"], revision: 0, user: null });
    await assert.rejects(transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" }));
    assert.equal(docs.get(roundPath)?.state, "active");
    assert.equal(docs.has(frozenPath("red")), false);
    assert.equal(docs.has(frozenPath("blue")), false);
  }
  {
    const value = fixture(), { db, docs } = value, { arrange } = helpers(value);
    await transitionPresentation(db, "demo", "host", current, current, { activateRound: "sorting" });
    await arrange("player", "red", ["a", "c", "b", "d"]);
    await transitionPresentation(db, "demo", "host", current, current, { closeRound: "sorting" });
    docs.set("rooms/demo/teams/red", { name: "Red", scoreTotal: 11 });
    docs.set("rooms/demo/teams/red/scores/sorting", { score: 1 });
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get(frozenPath("red"))?.awardedPoints, 2);
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 12);
    await gradeSortingRound(db, "demo", "sorting", "host");
    assert.equal(docs.get("rooms/demo/teams/red")?.scoreTotal, 12);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
