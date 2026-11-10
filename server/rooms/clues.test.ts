import assert from "node:assert/strict";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { validateQuizFile } from "./validation";
import { createRoundDocumentData, collectReferencedMedia } from "./manifest";
import { parseCluesRound, remainingCoins, positiveCoins, parseRevealedClues, DEFAULT_STARTING_COINS } from "@/types/clues";
import { parseQuizStage } from "@/types/quiz-stage";
import { getAwardShortcut, getIncorrectAwardShortcut, getAwardedPoints } from "@/lib/components/room/grading";
import { parseRoundMeta } from "@/lib/hooks/use-room-rounds";
import { parsePresentation, samePresentation } from "./presentation";
import { parseCluePurchase } from "./clues";
import { writeCluesRound } from "./clues-manifest";
import { clueMediaType } from "./clue-media";
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
  assert.ok(clueMediaType(media));
}
assert.throws(() => clueMediaType("script.js"));
assert.throws(() => parseQuizStage({ media: "/absolute.wav" }));
assert.equal(getAwardShortcut({}, { type: "clues" }), 1);
assert.equal(getIncorrectAwardShortcut({}, { type: "clues" }), 0);
assert.equal(getAwardedPoints(0.5, { type: "clues" }), 0.5);
assert.equal(getAwardedPoints(-1, { type: "clues" }), 0);
assert.equal(parseRoundMeta("r1", createRoundDocumentData(parsed[0]), 0)?.startingCoins, 5);
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
  const publicMedia: string[] = [], privateMedia: string[] = [];
  const resolve = (paths: string[], namespace: string) => async (stage: import("@/types/quiz-stage").QuizStage) => {
    if (stage.media) paths.push(stage.media);
    return { text: stage.text ?? null, media: stage.media ? { storagePath: `rooms/demo/${namespace}/${stage.media}`, filename: stage.media } : null };
  };
  await writeCluesRound(batch, db.collection("rooms").doc("demo").collection("rounds").doc("r1"), parseCluesRound(round), resolve(publicMedia, "media"), resolve(privateMedia, "clue-media"));
  const stored = documents.get("rooms/demo/rounds/r1/questions/question-1")!;
  assert.deepEqual(stored.clues, question.clues.map(({ id, category, price }) => ({ id, category, price })));
  assert.ok(!JSON.stringify(stored).includes("clue.mp3"));
  assert.ok(!JSON.stringify(stored).includes("Paris"));
  assert.deepEqual(publicMedia, ["intro.aac", "answer.webm"]);
  assert.deepEqual(privateMedia, ["paris.png", "clue.mp3"]);
  const definition = documents.get("rooms/demo/rounds/r1/questions/question-1/clues/music")!;
  assert.deepEqual(definition.content, { text: "Listen", media: { storagePath: "rooms/demo/clue-media/clue.mp3", filename: "clue.mp3" } });
  assert.deepEqual(documents.get("rooms/demo/rounds/r1/answers/question-1"), { hint: "Paris", stages: [{ text: "City on the Seine", media: { storagePath: "rooms/demo/media/answer.webm", filename: "answer.webm" } }] });
}
void manifest().catch((error) => { console.error(error); process.exitCode = 1; });
