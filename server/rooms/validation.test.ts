import assert from "node:assert/strict";

import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";

import { validateQuizFile } from "./validation";

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

// Playback limits belong to each reference, including fractional seconds.
{
  const result = parseQuiz({ type: "text", title: "Audio", questions: [{
    prompt: { stages: [{ media: { path: "song.mp3", durationSeconds: 0.1 } }] },
    answer: { hint: "Song", stages: [{ media: { path: "song.mp3", durationSeconds: 0.5 } }] },
  }] });
  assert.ok(typeof result !== "string" && result[0].type === "text");
  assert.equal(result[0].questions[0].promptStages[0].media?.durationSeconds, 0.1);
  assert.equal(result[0].questions[0].answerStages[0].media?.durationSeconds, 0.5);
}

for (const durationSeconds of [0, -1, null, "0.5"]) {
  expectValidationError({ type: "image", title: "Audio", questions: [{ image: "picture.png",
    prompt: { media: { path: "song.mp3", durationSeconds } },
  }] }, "durationSeconds must be a finite positive number");
}
expectValidationError({ type: "image", title: "Audio", questions: [{ image: "picture.png",
  prompt: { media: { path: "picture.png", durationSeconds: 1 } },
}] }, "only supported for audio");
expectValidationError({ type: "image", title: "Audio", questions: [{ image: "picture.png",
  prompt: { media: { path: "song.mp3", duration: 1 } },
}] }, "unsupported media field");

{
  const result = parseQuiz({ ...validMultiStepRound, questions: [{
    ...validMultiStepRound.questions[0], steps: [0.1, 0.5, 2.75].map((durationSeconds) => ({ media: { path: "song.m4a", durationSeconds } })),
  }] });
  assert.ok(typeof result !== "string" && result[0].type === "multi-step");
  assert.deepEqual(result[0].questions[0].steps.map((stage) => stage.media?.durationSeconds), [0.1, 0.5, 2.75]);
}

for (const path of ["song.mp3", "song.wav", "song.ogg", "song.m4a"]) {
  for (const durationSeconds of [0.1, 0.5, 2.75, undefined, 0, -1, null, "1"]) {
    const media = durationSeconds === undefined ? { path } : { path, durationSeconds };
    const quiz = [{ type: "text", title: "Audio", questions: [{
      prompt: { stages: [{ media }] }, answer: { hint: "Song", stages: [{ media: "song.mp3" }] },
    }] }];
    const valid = durationSeconds === undefined || (typeof durationSeconds === "number" && durationSeconds > 0);
    assert.equal(validateAgainstQuizSchema(quiz, schema).length === 0, valid);
    assert.equal(typeof validateQuizFile(JSON.stringify(quiz)) !== "string", valid);
  }
}
