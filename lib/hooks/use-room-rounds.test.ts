import assert from "node:assert/strict";

import { parseRoundMeta, parseStages } from "./use-room-rounds";

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

assert.deepEqual(parseStages([{ media: { storagePath: "song.mp3", durationSeconds: 0.1 } }])[0].media?.durationSeconds, 0.1);
