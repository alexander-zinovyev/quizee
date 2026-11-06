import assert from "node:assert/strict";
import { parseSortingOrder, parseSortingRound } from "@/types/sorting";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import schema from "@/types/quiz.schema.json";
import { validateQuizFile } from "./validation";
import { collectReferencedMedia, createRoundDocumentData } from "./manifest";

const pack = {
  type: "sorting", title: "Timeline", criterion: "Order these events from earliest to latest.",
  questions: [
    { id: "A", text: "First event" },
    { id: "B", media: "events/second.png" },
    { id: "C", text: "Third event", media: "events/third.mp3" },
    { id: "D", text: "Last event" },
  ],
  correctOrder: ["A", "B", "C", "D"],
};
assert.deepEqual(parseSortingRound(pack), pack);
assert.deepEqual(validateAgainstQuizSchema([pack], schema), []);
const validated = validateQuizFile(JSON.stringify([pack]));
assert.ok(Array.isArray(validated));
assert.equal(validated[0].type, "sorting");
assert.deepEqual([...collectReferencedMedia(validated)].sort(), ["events/second.png", "events/third.mp3"]);
const metadata = createRoundDocumentData(validated[0]);
assert.equal(metadata.questionCount, 4);
assert.ok(!("correctOrder" in metadata));
assert.ok(!("questions" in metadata));
assert.equal(metadata.criterion, pack.criterion);

for (const order of [[], ["A", "B", "C"], ["A", "B", "C", "C"], ["A", "B", "C", "unknown"], ["A", "B", "C", 4]]) {
  assert.throws(() => parseSortingOrder(order, pack.correctOrder));
  const bad = { ...pack, correctOrder: order };
  assert.equal(typeof validateQuizFile(JSON.stringify([bad])), "string");
  assert.ok(validateAgainstQuizSchema([bad], schema).length);
}
const { questions, ...roundMetadata } = pack;
for (const bad of [
  { ...pack, criterion: " " },
  { ...roundMetadata, items: questions.map(({ id, ...stage }) => ({ id, stages: [stage] })) },
  { ...pack, questions: [] },
  { ...pack, questions: [questions[0]] },
  { ...pack, questions: [questions[0], questions[0]] },
  { ...pack, questions: [{ id: "bad/id", text: "An item" }, questions[1]] },
  { ...pack, questions: [{ id: "__reserved__", text: "An item" }, questions[1]] },
  { ...pack, questions: [{ id: "A".repeat(1501), text: "An item" }, questions[1]] },
  { ...pack, questions: [{ id: "A", stages: [{ text: "An item" }] }, ...questions.slice(1)] },
  { ...pack, questions: [{ id: "A" }, ...questions.slice(1)] },
  { ...pack, questions: [{ id: "A", text: " " }, ...questions.slice(1)] },
  { ...pack, questions: [{ id: "A", text: "Item", answer: "spoiler" }, ...questions.slice(1)] },
  ...["../secret.png", "events/../secret.png", "./secret.png", "C:\\secret.png", "C:/secret.png", "https://example.com/secret.png", "/secret.png", "media/secret.png", "events/a.txt", "events/a\u0000.png"].map((media) => ({
    ...pack, questions: [{ id: "A", media }, ...questions.slice(1)],
  })),
]) {
  assert.throws(() => parseSortingRound(bad));
  assert.equal(typeof validateQuizFile(JSON.stringify([bad])), "string");
  assert.ok(validateAgainstQuizSchema([bad], schema).length);
}
assert.deepEqual(parseSortingOrder(["D", "C", "B", "A"], pack.correctOrder), ["D", "C", "B", "A"]);

const oversizedIds = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index).repeat(1000));
const oversized = { ...pack, questions: oversizedIds.map((id) => ({ id, text: "An item" })), correctOrder: oversizedIds };
assert.throws(() => parseSortingRound(oversized), /answer limit/);
assert.match(validateQuizFile(JSON.stringify([oversized])) as string, /answer limit/);
assert.ok(validateAgainstQuizSchema([oversized], schema).some((error) => error.includes("answer limit")));
const boundaryIds = Array.from({ length: 10 }, (_, index) => String.fromCharCode(65 + index).repeat(index === 9 ? 996 : 997));
assert.equal(JSON.stringify(boundaryIds).length, 10000);
assert.doesNotThrow(() => parseSortingRound({ ...pack, questions: boundaryIds.map((id) => ({ id, text: "An item" })), correctOrder: boundaryIds }));
