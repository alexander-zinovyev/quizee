import assert from "node:assert/strict";

import { buildQuizFromBuilderState } from "./page";
import type { BuildRound } from "@/lib/components/build/round-builder-panel";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import quizSchema from "@/types/quiz.schema.json";
import { validateQuizFile } from "@/server/rooms/validation";

const round: BuildRound = {
  id: "round-1",
  collapsed: false,
  name: "Clues",
  type: "multi-step",
  textQuestions: [],
  imageItems: [],
  multiStepQuestions: [
    {
      id: "question-1",
      collapsed: false,
      steps: [
        { id: "step-1", collapsed: false, text: "First", mediaPath: null },
        { id: "step-2", collapsed: false, text: "Second", mediaPath: null },
      ],
      answerHint: "Answer",
      answerStages: [{ id: "answer-1", collapsed: false, text: "Reveal", mediaPath: null }],
    },
  ],
  pointsPerStep: [5, 3],
  allowAnswerChanges: true,
};

const result = buildQuizFromBuilderState([round], []);
assert.deepEqual(validateAgainstQuizSchema(result.quizRounds, quizSchema), []);

const audioPath = "music/1_1.aac";
const audioRound: BuildRound = {
  ...round,
  multiStepQuestions: round.multiStepQuestions.map((question) => ({
    ...question,
    steps: question.steps.map((step) => ({ ...step, text: "", mediaPath: audioPath })),
  })),
};
const audioResult = buildQuizFromBuilderState([audioRound], [
  { id: audioPath, path: audioPath, name: "1_1.aac", file: new File([], "1_1.aac", { type: "audio/aac" }) },
]);
assert.deepEqual(audioResult.errors, []);
assert.deepEqual(validateAgainstQuizSchema(audioResult.quizRounds, quizSchema), []);
assert.notEqual(typeof validateQuizFile(JSON.stringify(audioResult.quizRounds)), "string");

// A round with many invalid steps must report its own errors, even when
// another round shape produces fewer errors.
const invalidStepsRound = {
  ...result.quizRounds[0],
  pointsPerStep: [5, 3, 1],
  questions: Array.from({ length: 8 }, () => ({
    steps: Array.from({ length: 3 }, () => ({ media: "unsupported.txt" })),
    answer: { hint: "Answer", stages: [{ text: "Reveal" }] },
  })),
};
const schemaErrors = validateAgainstQuizSchema([invalidStepsRound], quizSchema);
assert.equal(schemaErrors.length, 24);
assert.ok(schemaErrors.every((error) => error.includes("expected a relative media path")), schemaErrors.join("\n"));
assert.ok(schemaErrors[0].startsWith("Round 1, question 1 step 1 media:"));
const colorRound: BuildRound = { ...round, type: "color", name: "Colors", multiStepQuestions: [],
  scoring: { mode: "closest", points: 1, tieTolerance: 0.05 }, colorQuestions: [
    { id: "color-1", image: "image.png", mask: "mask.png", initialColor: "#123456", targetColor: "#FFFFFF" },
  ] };
const mediaFiles = ["image.png", "mask.png"].map((path) => ({ id: path, path, name: path, file: new File([], path), parentId: "root" }));
const colors = buildQuizFromBuilderState([colorRound], mediaFiles);
assert.deepEqual(colors.errors, []);
assert.deepEqual(colors.quizRounds, [{ type: "color", title: "Colors", scoring: colorRound.scoring,
  questions: [{ image: "image.png", mask: "mask.png", initialColor: "#123456", targetColor: "#FFFFFF" }] }]);
assert.ok(buildQuizFromBuilderState([colorRound], []).errors.length);
assert.ok(buildQuizFromBuilderState([{ ...colorRound, scoring: { mode: "threshold", points: 1, threshold: 11 } }], mediaFiles).errors.length);
const svgRound: BuildRound = { ...colorRound, colorQuestions: [{ id: "vector-1", image: "logo.svg", regionIds: ["left", "right"], initialColor: "#123456", targetColor: "#FFFFFF" }] };
const svgMedia = [{ id: "logo.svg", name: "logo.svg", path: "logo.svg", file: new File([], "logo.svg") }];
const vectors = buildQuizFromBuilderState([svgRound], svgMedia);
assert.deepEqual(vectors.errors, []);
assert.deepEqual(vectors.quizRounds[0].questions[0], { image: "logo.svg", regionIds: ["left", "right"], initialColor: "#123456", targetColor: "#FFFFFF" });
assert.ok(buildQuizFromBuilderState([{ ...svgRound, colorQuestions: [{ ...svgRound.colorQuestions![0], regionIds: ["left", "left"] }] }], svgMedia).errors.length);
assert.deepEqual(result.errors, []);
assert.deepEqual(result.quizRounds, [
  {
    type: "multi-step",
    title: "Clues",
    pointsPerStep: [5, 3],
    allowAnswerChanges: true,
    questions: [
      {
        steps: [{ text: "First" }, { text: "Second" }],
        answer: {
          hint: "Answer",
          stages: [{ text: "Reveal" }],
        },
      },
    ],
  },
]);

const bad = buildQuizFromBuilderState([{ ...round, pointsPerStep: [5, 3, 1] }], []);
assert.ok(bad.errors.some((error) => error.includes("step count must match points")));

for (const pointsPerStep of [[0, 0.5], [-2, 0], [0.5, 10]]) {
  const result = buildQuizFromBuilderState([{ ...round, pointsPerStep }], []);
  assert.deepEqual(result.errors, []);
  const builtRound = result.quizRounds[0];
  assert.ok(builtRound.type === "multi-step");
  assert.deepEqual(builtRound.pointsPerStep, pointsPerStep);
}

for (const pointsPerStep of [[NaN, 1], [Infinity, 1]]) {
  const result = buildQuizFromBuilderState([{ ...round, pointsPerStep }], []);
  assert.ok(result.errors.some((error) => error.includes("finite numbers")));
}
