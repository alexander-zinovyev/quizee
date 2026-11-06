import { closestCenter, pointerWithin, type CollisionDetection, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import type { SortingEdit } from "@/types/sorting";

export const sortingCollisionDetection: CollisionDetection = (args) => {
  const point = args.pointerCoordinates;
  if (!point) return closestCenter(args);
  const rects = args.droppableContainers.flatMap(({ id }) => {
    const rect = args.droppableRects.get(id);
    return rect ? [rect] : [];
  });
  if (!rects.length || point.x < Math.min(...rects.map((rect) => rect.left)) ||
      point.x > Math.max(...rects.map((rect) => rect.right)) || point.y < Math.min(...rects.map((rect) => rect.top)) ||
      point.y > Math.max(...rects.map((rect) => rect.bottom))) return [];
  const collisions = pointerWithin(args);
  if (collisions.length) return collisions;
  // Gaps belong to the list too. Measure from the pointer, not a potentially tall dragged card.
  return closestCenter({ ...args, collisionRect: { left: point.x, right: point.x, top: point.y, bottom: point.y, width: 0, height: 0 } });
};

export function sortingKeyboardCoordinates(order: readonly string[]): KeyboardCoordinateGetter {
  return (event, { active, context }) => {
    const direction = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
    if (!direction || !context.collisionRect) return;
    event.preventDefault();
    const index = order.indexOf(String(context.over?.id ?? active));
    const targetId = order[index + direction];
    const target = targetId === undefined ? undefined : context.droppableRects.get(targetId);
    if (!target) return;
    return { x: target.left, y: target.top + (target.height - context.collisionRect.height) / 2 };
  };
}

export function sortingMoveEdit(order: readonly string[], from: number, to: number): Omit<SortingEdit, "id"> | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= order.length || to >= order.length || from === to) return null;
  return { itemId: order[from], anchorId: order[to], placement: from < to ? "after" : "before" };
}
