import assert from "node:assert/strict";
import { parseBreakdownAttempts, parseBreakdownSortingOrder, parseDraftPoints } from "./team-score-breakdown";

assert.deepEqual(parseBreakdownAttempts([
  { answer: " First ", step: 0, submittedAt: "now", submittedBy: "player" },
  { answer: "Second", step: 1, submittedAt: "later", submittedBy: "player" },
]), [{ answer: "First", step: 0 }, { answer: "Second", step: 1 }]);
assert.deepEqual(parseBreakdownAttempts(undefined), []);
assert.throws(() => parseBreakdownAttempts([{ answer: "", step: 0 }]));
assert.equal(parseDraftPoints("0", { type: "multi-step" }), 0);
assert.equal(parseDraftPoints("0.5", { type: "multi-step" }), 0.5);
assert.equal(parseDraftPoints("-2", { type: "multi-step" }), -2);
assert.equal(parseDraftPoints("-2", { type: "text" }), 0);
for (const value of ["", " ", "NaN", "Infinity", "2oops"]) assert.equal(parseDraftPoints(value, { type: "multi-step" }), null);

const questions = [{ id: "a", text: "Event A" }, { id: "b", media: { storagePath: "rooms/demo/media/b.mp3" } }];
const sorting = parseBreakdownSortingOrder({ order: ["b", "a"], pointsByQuestion: {a:0,b:0} }, ["a", "b"], questions, true);
assert.deepEqual(sorting.order, ["b", "a"]);
assert.deepEqual(sorting.correctOrder, ["a", "b"]);
assert.deepEqual(sorting.pointsByQuestion, {a:0,b:0});
assert.equal(parseBreakdownSortingOrder({order:["a","b"]}, null, questions, false).correctOrder, null);
assert.throws(() => parseBreakdownSortingOrder({order:["a","a"]}, ["a","b"], questions, true));
assert.throws(() => parseBreakdownSortingOrder({order:["a","b"],pointsByQuestion:{a:1}}, ["a","b"], questions, true));
assert.equal(parseDraftPoints("2", { type: "sorting" }), 2);
