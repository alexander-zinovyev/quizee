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

// Export preserves different fractional limits on a shared source.
{
  const limited = structuredClone(round);
  limited.multiStepQuestions[0].steps[0] = { ...limited.multiStepQuestions[0].steps[0], mediaPath: "song.mp3", durationSeconds: 0.1 };
  limited.multiStepQuestions[0].steps[1] = { ...limited.multiStepQuestions[0].steps[1], mediaPath: "song.mp3", durationSeconds: 0.5 };
  limited.multiStepQuestions[0].answerStages[0] = { ...limited.multiStepQuestions[0].answerStages[0], mediaPath: "song.mp3", durationSeconds: 2.75 };
  const exported = buildQuizFromBuilderState([limited], [{ id: "audio", path: "song.mp3", name: "song.mp3", file: new File([], "song.mp3") }]);
  assert.deepEqual(exported.errors, []);
  const packed = exported.quizRounds[0];
  assert.ok(packed.type === "multi-step");
  assert.deepEqual(packed.questions[0].steps.map((stage) => stage.media), [
    { path: "song.mp3", durationSeconds: 0.1 }, { path: "song.mp3", durationSeconds: 0.5 },
  ]);
  assert.deepEqual(packed.questions[0].answer.stages[0].media, { path: "song.mp3", durationSeconds: 2.75 });
}
