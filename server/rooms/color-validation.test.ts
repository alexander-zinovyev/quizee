import assert from "node:assert/strict";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { validateQuizFile } from "./validation";
import { collectReferencedMedia, createRoundDocumentData } from "./manifest";
import { parseColorScoring } from "@/types/color";

const pack = [{ type: "color", title: "Colors", scoring: { mode: "threshold" }, questions: [
  { image: "logo.png", mask: "mask.png", initialColor: "#123abc", targetColor: "#FFFFFF" },
] }];
assert.deepEqual(validateAgainstQuizSchema(pack, schema), []);
const rounds = validateQuizFile(JSON.stringify(pack));
assert.ok(Array.isArray(rounds));
assert.deepEqual([...collectReferencedMedia(rounds)], ["logo.png", "mask.png"]);
assert.deepEqual(createRoundDocumentData(rounds[0]).scoring, { mode: "threshold", points: 1, threshold: 8.5 });
for (const scoring of [{ mode: "proportional" }, { mode: "closest" }, { mode: "threshold", points: 2, threshold: 9 }]) {
  const quiz = [{ ...pack[0], scoring }];
  assert.deepEqual(validateAgainstQuizSchema(quiz, schema), []);
  const validated = validateQuizFile(JSON.stringify(quiz));
  assert.ok(Array.isArray(validated));
  assert.deepEqual(createRoundDocumentData(validated[0]).scoring, parseColorScoring(scoring));
}
for (const invalid of ["red", "#FFF", "#12345678"]) {
  const copy = structuredClone(pack);
  copy[0].questions[0].targetColor = invalid;
  assert.equal(typeof validateQuizFile(JSON.stringify(copy)), "string");
  assert.ok(validateAgainstQuizSchema(copy, schema).length);
}
for (const scoring of [{ mode: "unknown" }, { mode: "threshold", threshold: 11 }, { mode: "closest", points: -1 }, { mode: "closest", tieTolerance: -1 },
  { mode: "proportional", points: 1 }, { mode: "proportional", threshold: 8.5 }, { mode: "proportional", tieTolerance: 0.05 }]) {
  assert.equal(typeof validateQuizFile(JSON.stringify([{ ...pack[0], scoring }])), "string");
  assert.ok(validateAgainstQuizSchema([{ ...pack[0], scoring }], schema).length);
}
