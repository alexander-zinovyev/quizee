import assert from "node:assert/strict";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { validateQuizFile } from "./validation";
import { createRoundDocumentData, collectReferencedMedia } from "./manifest";
import { cluePrice, parseCluePricing, parseCluesRound, parsePurchasedClueCounts, remainingCoins, positiveCoins, parseRevealedClues, DEFAULT_STARTING_COINS } from "@/types/clues";
import { parseQuizStage } from "@/types/quiz-stage";
import { getAwardShortcut, getIncorrectAwardShortcut, getAwardedPoints } from "@/lib/components/room/grading";
import { parseRoundMeta } from "@/lib/hooks/use-room-rounds";
import { parsePresentation, samePresentation } from "./presentation";
import { clueLedgerPath, parseCluePurchase, purchaseClue } from "./clues";
import { writeCluesRound } from "./clues-manifest";
import type { WriteBatch } from "firebase-admin/firestore";
import { database } from "./test-database";

const question = { generalClue: { text: "Name the place", media: "intro.aac" }, answer: { hint: "Paris", stages: [{ text: "City on the Seine", media: "answer.webm" }] }, clues: [
  { id: "history", category: "History", price: 2, content: { text: "A capital" } },
  { id: "photo", category: "Photo", price: 3, content: { media: "paris.png" } },
  { id: "music", category: "Music", price: 1, content: { text: "Listen", media: "clue.mp3" } },
] };
const round = { type: "clues", title: "Mystery", startingCoins: 5, questions: [question] };
assert.equal(DEFAULT_STARTING_COINS, 16);
assert.deepEqual(validateAgainstQuizSchema([round], schema), []);
const parsed = validateQuizFile(JSON.stringify([round]));
assert.ok(typeof parsed !== "string", String(parsed));
assert.equal(createRoundDocumentData(parsed[0]).startingCoins, 5);
assert.deepEqual([...collectReferencedMedia(parsed)], ["intro.aac", "answer.webm", "paris.png", "clue.mp3"]);
function refused(raw: unknown) {
  assert.ok(validateAgainstQuizSchema([raw], schema).length, JSON.stringify(raw));
  assert.equal(typeof validateQuizFile(JSON.stringify([raw])), "string");
}
for (const startingCoins of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "5"]) refused({ ...round, startingCoins });
for (const content of [{}, { text: " " }, { media: "../secret.png" }, { media: "script.js" }, { media: "media/foo.mp3" }, { text: "A", image: "photo.png" }]) {
  refused({ ...round, questions: [{ ...question, generalClue: content }] });
  refused({ ...round, questions: [{ ...question, clues: [{ ...question.clues[0], content }] }] });
  refused({ ...round, questions: [{ ...question, answer: { hint: "Paris", stages: [content] } }] });
}
for (const invalid of [
  { ...question, points: 2 }, { ...question, prompt: "Old prompt" }, { ...question, answer: "Old answer" },
  { ...question, answer: { hint: "", stages: [{ text: "Paris" }] } }, { ...question, answer: { hint: "Paris", stages: [] } },
  { ...question, clues: [] }, { ...question, clues: [question.clues[0], question.clues[0]] },
  { ...question, clues: [{ ...question.clues[0], price: 0 }] }, { ...question, clues: [{ ...question.clues[0], price: 1.5 }] },
]) refused({ ...round, questions: [invalid] });
for (const media of ["a.png", "a.gif", "a.svg", "a.mp3", "a.wav", "a.ogg", "a.m4a", "a.aac", "a.mp4", "a.mov", "a.webm"]) {
  const mediaOnly = { generalClue: { media }, answer: { hint: "Answer", stages: [{ media }] }, clues: [{ ...question.clues[0], content: { media } }] };
  assert.deepEqual(parseCluesRound({ ...round, questions: [mediaOnly] }).questions, [mediaOnly]);
  assert.deepEqual(validateAgainstQuizSchema([{ ...round, questions: [mediaOnly] }], schema), []);
}
assert.throws(() => parseQuizStage({ media: "/absolute.wav" }));
assert.equal(getAwardShortcut({}, { type: "clues" }), 1);
assert.equal(getIncorrectAwardShortcut({}, { type: "clues" }), 0);
assert.equal(getAwardedPoints(0.5, { type: "clues" }), 0.5);
assert.equal(getAwardedPoints(-1, { type: "clues" }), 0);
assert.equal(parseRoundMeta("r1", createRoundDocumentData(parsed[0]), 0)?.startingCoins, 5);
for (const mode of ["arithmetic", "geometric"] as const) {
  assert.deepEqual([0, 1, 2, 3].map((count) => cluePrice(parseCluePricing({ mode }), {}, count)), mode === "arithmetic" ? [1, 2, 3, 4] : [1, 2, 4, 8]);
  const progressive = { ...round, pricing: { mode }, questions: [{ ...question,
    clues: question.clues.map(({ id, category, content }) => ({ id, category, content })) }] };
  assert.deepEqual(validateAgainstQuizSchema([progressive], schema), []);
  const configured = parseCluesRound(progressive);
  assert.deepEqual(configured.pricing, { mode, basePrice: 1, progression: mode === "arithmetic" ? 1 : 2 });
  assert.deepEqual(parseRoundMeta("r1", createRoundDocumentData({ ...configured, order: 0 }), 0)?.pricing, configured.pricing);
  for (const field of ["basePrice", "progression"]) for (const value of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    refused({ ...progressive, pricing: { mode, [field]: value } });
  }
  refused({ ...progressive, pricing: { mode, basePrice: Number.MAX_SAFE_INTEGER, progression: 2 } });
}
for (const count of [-1, 0.5, NaN, Infinity]) assert.throws(() => cluePrice(parseCluePricing({ mode: "arithmetic" }), {}, count));
for (const counts of [null, [], 1, { q1: -1 }, { q1: 1.5 }, { q1: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => parsePurchasedClueCounts(counts));
assert.deepEqual(parsePurchasedClueCounts(undefined), {});
assert.deepEqual(parsePurchasedClueCounts({ q1: 2, q2: 0 }), { q1: 2, q2: 0 });
assert.equal(cluePrice({ mode: "arithmetic", basePrice: 1, progression: Number.MAX_SAFE_INTEGER - 1 }, {}, 1), Number.MAX_SAFE_INTEGER);
assert.throws(() => cluePrice({ mode: "arithmetic", basePrice: 1, progression: Number.MAX_SAFE_INTEGER }, {}, 1));
assert.equal(parseCluesRound({ ...round, pricing: { mode: "geometric", progression: 1, basePrice: Number.MAX_SAFE_INTEGER } }).pricing?.mode, "geometric");
assert.deepEqual(parseCluesRound({ ...round, pricing: { mode: "manual" } }).pricing, { mode: "manual" });
for (const pricing of [null, {}, { mode: "unknown" }, { mode: "manual", basePrice: 1 }, { mode: "geometric", extra: 2 }]) refused({ ...round, pricing });
refused({ ...round, questions: [{ ...question, clues: [{ id: "missing", category: "Missing", content: { text: "Hidden" } }] }] });
assert.equal(remainingCoins(0, 5), 0);
for (const value of [undefined, -1, 6, 1.5, NaN, "0"]) assert.throws(() => remainingCoins(value, 5));
assert.throws(() => positiveCoins(0));
for (const raw of [["same", "same"], ["bad/id"], "x", [1]]) assert.throws(() => parseRevealedClues(raw));
for (const raw of [{ teamId: "red", price: 0 }, { teamId: "red/blue" }, { teamId: "" }]) assert.throws(() => parseCluePurchase(raw));
const presentation = { round: "r1", question: "q1", withAnswer: false, promptPage: 0, answerPage: 0 };
assert.equal(samePresentation(presentation, parsePresentation(presentation)), true);
assert.equal(samePresentation(presentation, { ...presentation, revealedClueIds: ["photo"] }), false);

async function manifest() {
  const { db } = database("text");
  const documents = new Map<string, Record<string, unknown>>();
  const batch = { set: (ref: { path: string }, data: Record<string, unknown>) => { documents.set(ref.path, data); } } as unknown as WriteBatch;
  const resolvedMedia: string[] = [];
  const resolve = async (stage: import("@/types/quiz-stage").QuizStage) => {
    if (stage.media) resolvedMedia.push(stage.media);
    return { text: stage.text ?? null, media: stage.media ? { storagePath: `rooms/demo/media/${stage.media}`, filename: stage.media } : null };
  };
  await writeCluesRound(batch, db.collection("rooms").doc("demo").collection("rounds").doc("r1"), parseCluesRound(round), resolve);
  const stored = documents.get("rooms/demo/rounds/r1/questions/question-1")!;
  assert.deepEqual(stored.clues, question.clues.map(({ id, category, price }) => ({ id, category, price })));
  assert.ok(!JSON.stringify(stored).includes("clue.mp3"));
  assert.ok(!JSON.stringify(stored).includes("Paris"));
  assert.deepEqual(resolvedMedia, ["intro.aac", "answer.webm", "paris.png", "clue.mp3"]);
  const definition = documents.get("rooms/demo/rounds/r1/questions/question-1/clues/music")!;
  assert.deepEqual(definition.content, { text: "Listen", media: { storagePath: "rooms/demo/media/clue.mp3", filename: "clue.mp3" } });
  assert.deepEqual(documents.get("rooms/demo/rounds/r1/answers/question-1"), { hint: "Paris", stages: [{ text: "City on the Seine", media: { storagePath: "rooms/demo/media/answer.webm", filename: "answer.webm" } }] });
  await writeCluesRound(batch, db.collection("rooms").doc("demo").collection("rounds").doc("r2"), parseCluesRound({ ...round,
    pricing: { mode: "geometric" }, questions: [{ ...question, clues: question.clues.map(({ id, category, content }) => ({ id, category, content })) }] }), resolve);
  assert.deepEqual(documents.get("rooms/demo/rounds/r2/questions/question-1")?.clues, question.clues.map(({ id, category }) => ({ id, category })));
  assert.equal(Object.hasOwn(documents.get("rooms/demo/rounds/r2/questions/question-1/clues/music")!, "price"), false);
}
async function independentPurchases() {
  const { db, docs } = database("clues");
  const roomPath = "rooms/demo";
  const roundPath = `${roomPath}/rounds/r1`;
  docs.set(roundPath, { type: "clues", state: "active", startingCoins: 5 });
  for (const id of ["q1", "q2"]) {
    docs.set(`${roundPath}/questions/${id}`, { clues: [{ id: "hint", category: "Hint", price: 2 }] });
    docs.set(`${roundPath}/questions/${id}/clues/hint`, { price: 2, content: { text: `Secret ${id}` } });
  }
  const buy = (questionId: string, uid = "player", teamId = "red") => purchaseClue(db, "demo", "r1", questionId, "hint", uid, teamId);
  // The host is presenting q1; players can buy on q2 without changing that presentation.
  assert.deepEqual(await buy("q2"), { remainingCoins: 3 });
  assert.deepEqual(await buy("q2", "teammate"), { remainingCoins: 3 });
  assert.deepEqual(await buy("q2", "outsider", "blue"), { remainingCoins: 3 });
  assert.equal(docs.get(clueLedgerPath("demo", "red", "r1"))?.remainingCoins, 3);
  docs.set(roomPath, { state: "playing", presenting: { round: null, question: null, withAnswer: false } });
  assert.deepEqual(await buy("q1"), { remainingCoins: 1 });
  docs.set(roundPath, { type: "clues", state: "closed", startingCoins: 5 });
  await assert.rejects(buy("q1", "outsider", "blue"), /not accepting/);
  assert.deepEqual(await buy("q2"), { remainingCoins: 1 }, "Existing purchases remain free after closure");
}
async function progressivePurchases() {
  for (const [pricing, prices] of [
    [{ mode: "arithmetic" }, [1, 2, 3]],
    [{ mode: "geometric" }, [1, 2, 4]],
    [{ mode: "arithmetic", basePrice: 2, progression: 3 }, [2, 5, 8]],
    [{ mode: "geometric", basePrice: 2, progression: 3 }, [2, 6, 18]],
    [{ mode: "geometric", basePrice: 2, progression: 1 }, [2, 2, 2]],
  ] as const) {
    const { db, docs } = database("clues");
    const roundPath = "rooms/demo/rounds/r1";
    docs.set(roundPath, { type: "clues", state: "active", startingCoins: 100, pricing });
    for (const questionId of ["q1", "q2"]) {
      docs.set(`${roundPath}/questions/${questionId}`, { clues: question.clues.map(({ id, category }) => ({ id, category })) });
      for (const clue of question.clues) docs.set(`${roundPath}/questions/${questionId}/clues/${clue.id}`, { content: { text: clue.id } });
    }
    const buy = (clue: string, questionId = "q1", uid = "player", team = "red") => purchaseClue(db, "demo", "r1", questionId, clue, uid, team);
    let balance = 100;
    // Choose clues in a different order from their pack order.
    for (const [index, id] of ["music", "history", "photo"].entries()) {
      balance -= prices[index];
      assert.deepEqual(await buy(id), { remainingCoins: balance });
      assert.deepEqual(await buy(id, "q1", "teammate"), { remainingCoins: balance });
    }
    assert.deepEqual(await buy("photo", "q2"), { remainingCoins: balance - prices[0] });
    assert.deepEqual(docs.get(clueLedgerPath("demo", "red", "r1"))?.purchasedCounts, { q1: 3, q2: 1 });
    assert.deepEqual(await buy("photo", "q1", "outsider", "blue"), { remainingCoins: 100 - prices[0] });
    const ledgerPath = clueLedgerPath("demo", "red", "r1");
    docs.set(ledgerPath, { ...docs.get(ledgerPath), remainingCoins: 0 });
    const before = new Map(docs);
    await assert.rejects(buy("history", "q2"), /Not enough coins/);
    assert.deepEqual(docs, before, "Insufficient funds change neither purchases nor balance");
    assert.deepEqual(await buy("photo"), { remainingCoins: 0 }, "Previously purchased clues remain free");
  }
}
void Promise.all([manifest(), independentPurchases(), progressivePurchases()]).catch((error) => { console.error(error); process.exitCode = 1; });
