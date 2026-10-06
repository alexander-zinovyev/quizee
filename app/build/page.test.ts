import assert from "node:assert/strict";

import { buildQuizFromBuilderState } from "./page";
import type { BuildRound } from "@/lib/components/build/round-builder-panel";

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
