import assert from "node:assert/strict";

import { collectReferencedMedia, createRoundDocumentData } from "./manifest";
import type { ValidatedRound } from "./validation";

const rounds: ValidatedRound[] = [
  {
    order: 0,
    type: "multi-step",
    title: "Clues",
    pointsPerStep: [5, 3],
    allowAnswerChanges: true,
    questions: [
      {
        order: 0,
        steps: [
          { text: "First", media: { path: "steps/first.jpg" } },
          { text: "Second" },
        ],
        answerHint: "Answer",
        answerStages: [{ media: { path: "answers/reveal.mp3" } }],
      },
    ],
  },
  {
    order: 1,
    type: "image",
    title: "Images",
    questions: [
      {
        order: 0,
        prompt: { text: "Prompt", media: { path: "prompts/prompt.png" } },
        imagePath: "images/answer.png",
      },
    ],
  },
];

assert.deepEqual(Array.from(collectReferencedMedia(rounds)).sort(), [
  "answers/reveal.mp3",
  "images/answer.png",
  "prompts/prompt.png",
  "steps/first.jpg",
]);

assert.deepEqual(createRoundDocumentData(rounds[0]), {
  type: "multi-step",
  title: "Clues",
  order: 0,
  state: "scheduled",
  activeWindow: { startedAt: null, endedAt: null },
  questionCount: 1,
  gradingRequired: false,
  pointsPerStep: [5, 3],
  allowAnswerChanges: true,
});
