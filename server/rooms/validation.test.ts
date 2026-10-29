import assert from "node:assert/strict";

import { validateQuizFile, validateRoomId } from "./validation";

for (const reserved of ["host", "build", "stats", "login", "api"]) assert.notEqual(validateRoomId(reserved), null);
assert.equal(validateRoomId("quiz-night"), null);

function parseQuiz(round: unknown) {
  return validateQuizFile(JSON.stringify([round]));
}

function expectValidationError(round: unknown, expected: string) {
  const result = parseQuiz(round);
  assert.equal(typeof result, "string");
  assert.match(result as string, new RegExp(expected));
}

const validMultiStepRound = {
  type: "multi-step",
  title: "Who am I?",
  pointsPerStep: [5, 3, 1],
  allowAnswerChanges: true,
  questions: [
    {
      steps: [
        { text: "Born in 1879" },
        { text: "Worked in a patent office" },
        { text: "Known for relativity", media: "clues/einstein.jpg" },
      ],
      answer: {
        hint: "Albert Einstein",
        stages: [{ text: "Albert Einstein" }],
      },
    },
  ],
};

{
  const result = parseQuiz(validMultiStepRound);
  assert.notEqual(typeof result, "string");
  const [round] = result as Exclude<typeof result, string>;
  assert.equal(round.type, "multi-step");
  assert.deepEqual(round.pointsPerStep, [5, 3, 1]);
  assert.equal(round.allowAnswerChanges, true);
  assert.equal(round.questions[0].steps.length, 3);
  assert.equal(round.questions[0].answerHint, "Albert Einstein");
}

expectValidationError(
  { ...validMultiStepRound, pointsPerStep: [] },
  "pointsPerStep array is required"
);

expectValidationError(
  { ...validMultiStepRound, pointsPerStep: [5, "0.5", 1] },
  "pointsPerStep 2 must be a finite number"
);

{
  const pointsPerStep = [0, 0.5, -2];
  const result = parseQuiz({ ...validMultiStepRound, pointsPerStep });
  assert.notEqual(typeof result, "string");
  const [round] = result as Exclude<typeof result, string>;
  assert.ok(round.type === "multi-step");
  assert.deepEqual(round.pointsPerStep, pointsPerStep);
}

expectValidationError(
  { ...validMultiStepRound, pointsPerStep: [5, Infinity, 1] },
  "pointsPerStep 2 must be a finite number"
);

expectValidationError(
  { ...validMultiStepRound, allowAnswerChanges: "yes" },
  "allowAnswerChanges boolean is required"
);

expectValidationError(
  {
    ...validMultiStepRound,
    questions: [
      {
        ...validMultiStepRound.questions[0],
        steps: [{ text: "Only one clue" }],
      },
    ],
  },
  "steps length must match pointsPerStep length"
);

expectValidationError(
  {
    ...validMultiStepRound,
    questions: [
      {
        ...validMultiStepRound.questions[0],
        steps: [{ text: "First" }, {}, { text: "Third" }],
      },
    ],
  },
  "steps, stage 2: at least one of text or media is required"
);
