import assert from "node:assert/strict";

import { getActiveRounds, getSortingQuestions, parseRoundMeta, parseStages } from "./use-room-rounds";

assert.deepEqual(
  parseRoundMeta(
    "round-1",
    {
      type: "multi-step",
      title: "Clues",
      order: 2,
      state: "active",
      gradingRequired: true,
      pointsPerStep: [5, 3, 1],
      allowAnswerChanges: false,
    },
    0
  ),
  {
    id: "round-1",
    title: "Clues",
    order: 2,
    type: "multi-step",
    state: "active",
    gradingRequired: true,
    pointsPerStep: [5, 3, 1],
    allowAnswerChanges: false,
  }
);

assert.equal(parseRoundMeta("round-2", { type: "unknown" }, 1), null);

assert.deepEqual(
  parseRoundMeta("round-3", { type: "multi-step", pointsPerStep: [0, 0.5, -2] }, 2)?.pointsPerStep,
  [0, 0.5, -2]
);
assert.equal(
  parseRoundMeta("round-4", { type: "multi-step", pointsPerStep: [5, Infinity, 1] }, 3)?.pointsPerStep,
  undefined
);

assert.deepEqual(
  parseStages([
    { text: "  First clue  " },
    {
      media: {
        storagePath: "rooms/demo/media/clue.jpg",
        contentType: "image/jpeg",
      },
    },
    {},
  ]),
  [
    { text: "First clue" },
    {
      media: {
        storagePath: "rooms/demo/media/clue.jpg",
        contentType: "image/jpeg",
        size: null,
        filename: null,
        originalPath: null,
      },
    },
  ]
);

// Every ended round, including sorting, leaves the active-round area.
assert.deepEqual(getActiveRounds((["text", "image", "sorting"] as const).flatMap((type) => (["active", "closed"] as const).map((state) => ({ id: `${type}-${state}`, title: type, order: 0, type, state })))).map((round) => round.id), ["text-active", "image-active", "sorting-active"]);
assert.deepEqual(getSortingQuestions([{id:"a",prompt:"A",displayPrompt:"A",order:0}]), [{id:"a",text:"A"}]);
