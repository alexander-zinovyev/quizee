import assert from "node:assert/strict";
import { parseHostRoundAnswers } from "./room-round-answers";

assert.deepEqual(parseHostRoundAnswers("image", [{ id: "description", data: { answer: "image-2", hint: "Not the image ID" } }]).answers,
  { description: "image-2" });
assert.deepEqual(parseHostRoundAnswers("sorting", [{ id: "order", data: { correctOrder: ["b", "a"] } }]).correctOrder, ["b", "a"]);
for (const value of [null, [], ["a"], ["a", "a"], ["a", 1]]) {
  assert.throws(() => parseHostRoundAnswers("sorting", [{ id: "order", data: { correctOrder: value } }]));
}
const text = parseHostRoundAnswers("text", [{ id: "q1", data: { hint: "  Paris  ", stages: [{ text: "France" }] } },
  { id: "q2", data: { stages: [{ media: "answer.jpg" }, { text: "  London " }] } }, { id: "q3", data: { stages: [{ media: "media-only.jpg" }] } }]);
assert.deepEqual(text.answers, { q1: "Paris", q2: "London", q3: "" });
assert.deepEqual(text.hints, { q1: "Paris", q2: "", q3: "" });
