import assert from "node:assert/strict";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { validateQuizFile } from "./validation";
import { createRoundDocumentData, collectReferencedMedia } from "./manifest";
import { getAwardShortcut, getIncorrectAwardShortcut, getAwardedPoints } from "@/lib/components/room/grading";
import { parseRoundMeta } from "@/lib/hooks/use-room-rounds";
import { parsePresentation, samePresentation } from "./presentation";
import { positiveCoins, parseRevealedClues, parseCluesRound } from "@/types/clues";
import { remainingCoins, parseCluePurchase } from "./clues";
import { prepareClueImage } from "./clue-image";
import sharp from "sharp";
import { writeCluesRound } from "./clues-manifest";
import type { Bucket } from "@google-cloud/storage";
import type { WriteBatch } from "firebase-admin/firestore";
import { database } from "./test-database";

export const cluesPack = { type: "clues", title: "Mystery", startingCoins: 5, questions: [
  { prompt: "Name the place", answer: "Paris", clues: [
    { id: "history", category: "History", price: 2, text: "A capital" },
    { id: "photo", category: "Photo", price: 3, text: "The skyline", image: "paris.png" },
  ] },
] };
assert.deepEqual(validateAgainstQuizSchema([cluesPack], schema), []);
const parsed = validateQuizFile(JSON.stringify([cluesPack]));
assert.ok(typeof parsed !== "string", String(parsed));
assert.equal(createRoundDocumentData(parsed[0]).startingCoins, 5);
assert.deepEqual([...collectReferencedMedia(parsed)], ["paris.png"]);
for (const startingCoins of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "5"]) {
  const invalid = [{ ...cluesPack, startingCoins }];
  assert.ok(validateAgainstQuizSchema(invalid, schema).length);
  assert.equal(typeof validateQuizFile(JSON.stringify(invalid)), "string");
}
for (const clue of [
  { ...cluesPack.questions[0].clues[0], price: 0 },
  { ...cluesPack.questions[0].clues[0], price: 1.5 },
  { ...cluesPack.questions[0].clues[0], image: "../secret.png" },
  { ...cluesPack.questions[0].clues[0], image: "audio.mp3" },
  { ...cluesPack.questions[0].clues[0], text: " " },
]) {
  const invalid = [{ ...cluesPack, questions: [{ ...cluesPack.questions[0], clues: [clue] }] }];
  assert.ok(validateAgainstQuizSchema(invalid, schema).length);
  assert.equal(typeof validateQuizFile(JSON.stringify(invalid)), "string");
}
for (const question of [
  { ...cluesPack.questions[0], points: 2 },
  { ...cluesPack.questions[0], clues: [] },
  { ...cluesPack.questions[0], clues: [cluesPack.questions[0].clues[0], cluesPack.questions[0].clues[0]] },
]) {
  const invalid = [{ ...cluesPack, questions: [question] }];
  assert.ok(validateAgainstQuizSchema(invalid, schema).length);
  assert.equal(typeof validateQuizFile(JSON.stringify(invalid)), "string");
}

// Live coin state never participates in grading, including partial-credit adjustments.
assert.equal(getAwardShortcut({}, { type: "clues" }), 1);
assert.equal(getIncorrectAwardShortcut({}, { type: "clues" }), 0);
assert.equal(getAwardedPoints(0.5, { type: "clues" }), 0.5);
assert.equal(getAwardedPoints(-1, { type: "clues" }), 0);
assert.equal(parseRoundMeta("r1", createRoundDocumentData(parsed[0]), 0)?.startingCoins, 5);
assert.equal(remainingCoins(0, 5), 0);
assert.throws(() => remainingCoins(undefined, 5));
for (const value of [-1, 6, 1.5, NaN, "0"]) assert.throws(() => remainingCoins(value, 5));
assert.throws(() => positiveCoins(0));
for (const raw of [["same", "same"], ["bad/id"], "x", [1]]) assert.throws(() => parseRevealedClues(raw));
for (const raw of [{ teamId: "red", price: 0 }, { teamId: "red/blue" }, { teamId: "" }]) assert.throws(() => parseCluePurchase(raw));
const presentation = { round: "r1", question: "q1", withAnswer: false, promptPage: 0, answerPage: 0 };
assert.equal(samePresentation(presentation, parsePresentation(presentation)), true);
assert.equal(samePresentation(presentation, { ...presentation, revealedClueIds: ["photo"] }), false);
async function images() {
  const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer();
  const normalized = await prepareClueImage(source);
  assert.equal((await sharp(normalized).metadata()).format, "png");
  const vector = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>');
  assert.equal((await sharp(await prepareClueImage(vector)).metadata()).format, "png");
  await assert.rejects(prepareClueImage(Buffer.from("malformed image")));
  await assert.rejects(prepareClueImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>')));
}
void images().catch((error) => { console.error(error); process.exitCode = 1; });

async function manifest() {
  const { db } = database("text");
  const documents = new Map<string, Record<string, unknown>>();
  const savedImages = new Map<string, { bytes: Buffer; options: unknown }>();
  const batch = { set: (ref: { path: string }, data: Record<string, unknown>) => { documents.set(ref.path, data); } } as unknown as WriteBatch;
  const bucket = { file: (path: string) => ({ save: async (bytes: Buffer, options: unknown) => { savedImages.set(path, { bytes, options }); } }) } as unknown as Bucket;
  const image = Buffer.from("prepared PNG");
  await writeCluesRound(batch, db.collection("rooms").doc("demo").collection("rounds").doc("r1"), "demo", parseCluesRound(cluesPack), new Map([["paris.png", image]]), bucket);
  const question = documents.get("rooms/demo/rounds/r1/questions/question-1")!;
  assert.deepEqual(question.clues, [{ id: "history", category: "History", price: 2 }, { id: "photo", category: "Photo", price: 3 }]);
  assert.ok(!JSON.stringify(question).includes("skyline"));
  assert.ok(!JSON.stringify(question).includes("Paris"));
  const definition = documents.get("rooms/demo/rounds/r1/questions/question-1/clues/photo")!;
  assert.equal(definition.text, "The skyline");
  const path = (definition.media as { storagePath: string }).storagePath;
  assert.ok(path.startsWith("rooms/demo/clue-media/"));
  assert.deepEqual(savedImages.get(path)?.bytes, image);
  assert.deepEqual(savedImages.get(path)?.options, { metadata: { contentType: "image/png", cacheControl: "no-store", metadata: {} } });
  assert.deepEqual(documents.get("rooms/demo/rounds/r1/answers/question-1"), { hint: "Paris", stages: [{ text: "Paris" }] });
}
void manifest().catch((error) => { console.error(error); process.exitCode = 1; });
