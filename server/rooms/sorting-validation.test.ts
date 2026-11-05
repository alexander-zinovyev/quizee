import assert from "node:assert/strict";
import { parseSortingOrder, parseSortingRound } from "@/types/sorting";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import schema from "@/types/quiz.schema.json";
import { validateQuizFile } from "./validation";
import { collectReferencedMedia, createRoundDocumentData } from "./manifest";

const pack = {
  type: "sorting", title: "Timeline", criterion: "Order these events from earliest to latest.",
  items: [
    { id: "A", stages: [{ text: "First event" }] },
    { id: "B", stages: [{ media: "events/second.png" }] },
    { id: "C", stages: [{ text: "Third event", media: "events/third.mp3" }, { media: "events/third.webm" }] },
    { id: "D", stages: [{ text: "Last event" }] },
  ],
  correctOrder: ["A", "B", "C", "D"],
};
assert.deepEqual(parseSortingRound(pack), pack);
assert.deepEqual(validateAgainstQuizSchema([pack], schema), []);
const validated = validateQuizFile(JSON.stringify([pack]));
assert.ok(Array.isArray(validated));
assert.equal(validated[0].type, "sorting");
assert.deepEqual([...collectReferencedMedia(validated)].sort(), ["events/second.png", "events/third.mp3", "events/third.webm"]);
const metadata = createRoundDocumentData(validated[0]);
assert.equal(metadata.questionCount, 1);
assert.ok(!("correctOrder" in metadata));
assert.ok(!("items" in metadata));

for (const order of [[], ["A", "B", "C"], ["A", "B", "C", "C"], ["A", "B", "C", "unknown"], ["A", "B", "C", 4]]) {
  assert.throws(() => parseSortingOrder(order, pack.correctOrder));
  const bad = { ...pack, correctOrder: order };
  assert.equal(typeof validateQuizFile(JSON.stringify([bad])), "string");
  assert.ok(validateAgainstQuizSchema([bad], schema).length);
}
for (const bad of [
  { ...pack, criterion: " " },
  { ...pack, questions: [] },
  { ...pack, items: [] },
  { ...pack, items: [pack.items[0]] },
  { ...pack, items: [pack.items[0], pack.items[0]] },
  { ...pack, items: [{ id: "bad/id", stages: [{ text: "An item" }] }, pack.items[1]] },
  { ...pack, items: [{ id: "A", stages: [] }, ...pack.items.slice(1)] },
  { ...pack, items: [{ id: "A", stages: [{}] }, ...pack.items.slice(1)] },
  { ...pack, items: [{ id: "A", stages: [{ text: " " }] }, ...pack.items.slice(1)] },
  { ...pack, items: [{ id: "A", stages: [{ text: "Item", answer: "spoiler" }] }, ...pack.items.slice(1)] },
  ...["../secret.png", "events/../secret.png", "./secret.png", "C:\\secret.png", "C:/secret.png", "https://example.com/secret.png", "/secret.png", "media/secret.png", "events/a.txt", "events/a\u0000.png"].map((media) => ({
    ...pack, items: [{ id: "A", stages: [{ media }] }, ...pack.items.slice(1)],
  })),
]) {
  assert.throws(() => parseSortingRound(bad));
  assert.equal(typeof validateQuizFile(JSON.stringify([bad])), "string");
  assert.ok(validateAgainstQuizSchema([bad], schema).length);
}
assert.deepEqual(parseSortingOrder(["D", "C", "B", "A"], pack.correctOrder), ["D", "C", "B", "A"]);

// A valid authored order must fit the same answer transport limit as every permutation.
const oversizedIds = ["A".repeat(5000), "B".repeat(5000)];
const oversized = { ...pack, items: oversizedIds.map((id) => ({ id, stages: [{ text: "An item" }] })), correctOrder: oversizedIds };
assert.throws(() => parseSortingRound(oversized), /answer limit/);
assert.match(validateQuizFile(JSON.stringify([oversized])) as string, /answer limit/);
assert.ok(validateAgainstQuizSchema([oversized], schema).some((error) => error.includes("answer limit")));
const boundaryIds = ["A".repeat(4996), "B".repeat(4997)];
assert.equal(JSON.stringify(boundaryIds).length, 10000);
assert.doesNotThrow(() => parseSortingRound({ ...pack, items: boundaryIds.map((id) => ({ id, stages: [{ text: "An item" }] })), correctOrder: boundaryIds }));
