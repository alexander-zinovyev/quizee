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

const items = [{ id: "a", stages: [{ text: "Event A" }] }, { id: "b", stages: [{ media: { storagePath: "rooms/demo/media/b.mp3" } }] }];
const sorting = parseBreakdownSortingOrder('["b","a"]', items)!;
assert.deepEqual(sorting.order.map((id) => sorting.items.find((item) => item.id === id)?.stages), [items[1].stages, items[0].stages]);
assert.equal(parseBreakdownSortingOrder("", items), undefined);
assert.throws(() => parseBreakdownSortingOrder('["a","a"]', items));
assert.throws(() => parseBreakdownSortingOrder("bad JSON", items));
assert.equal(parseDraftPoints("2", { type: "sorting" }), 2);
