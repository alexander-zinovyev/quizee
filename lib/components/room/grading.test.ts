import assert from "node:assert/strict";
import { getAwardedPoints, getAwardShortcut } from "./grading";

const round = { type: "multi-step", pointsPerStep: [5, 0, 0.5, -2] };
assert.equal(getAwardShortcut({ step: 0 }, round), 5);
assert.equal(getAwardShortcut({ step: 1 }, round), 0);
assert.equal(getAwardShortcut({ step: 2 }, round), 0.5);
assert.equal(getAwardShortcut({ step: 3 }, round), -2);
assert.equal(getAwardShortcut({ step: null }, round), 0);
assert.equal(getAwardShortcut({}, { type: "text" }), 1);
assert.equal(getAwardShortcut({ step: 0, eligiblePoints: 999 } as { step: number }, round), 5);
assert.throws(() => getAwardShortcut({ step: 4 }, round));
assert.throws(() => getAwardShortcut({ step: -1 }, round));
assert.throws(() => getAwardShortcut({ step: 0 }, { type: "multi-step" }));
for (const points of [0, 0.5, -2]) assert.equal(getAwardedPoints(points, "multi-step"), points);
assert.equal(getAwardedPoints(-2, "text"), 0);
assert.equal(getAwardedPoints(-2, "image"), 0);
assert.throws(() => getAwardedPoints(Infinity, "multi-step"));
assert.throws(() => getAwardedPoints(NaN, "multi-step"));
