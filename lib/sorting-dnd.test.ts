import assert from "node:assert/strict";
import type { CollisionDetection } from "@dnd-kit/core";
import { sortingCollisionDetection, sortingMoveEdit } from "./sorting-dnd";
import { applySortingEdit } from "@/types/sorting";

const rect = (top: number, height = 32) => ({ top, bottom: top + height, left: 0, right: 200, width: 200, height });
function collision(x: number, y: number) {
  return sortingCollisionDetection({ pointerCoordinates: { x, y },
    droppableRects: new Map([["a", rect(0)], ["b", rect(40)], ["c", rect(80)]]),
    droppableContainers: [{ id: "a" }, { id: "b" }, { id: "c" }],
  } as unknown as Parameters<CollisionDetection>[0]);
}
// A continuous list must not lose its insertion target in the gap after B.
assert.ok(collision(50, 76).length > 0);
assert.notEqual(collision(50, 76)[0].id, "a");
assert.equal(collision(50, 56)[0].id, "b");
assert.deepEqual(collision(201, 76), []);
assert.deepEqual(collision(50, 120), []);
for (const [from, to, expected] of [[0, 2, ["b", "c", "a"]], [2, 0, ["c", "a", "b"]]] as const) {
  const edit = sortingMoveEdit(["a", "b", "c"], from, to)!;
  assert.deepEqual(applySortingEdit(["a", "b", "c"], { ...edit, id: "test" }), expected);
}
assert.equal(sortingMoveEdit(["a", "b"], 0, 0), null);
