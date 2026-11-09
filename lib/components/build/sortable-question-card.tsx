"use client";

import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableQuestionCard({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };

  const dragHandle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded bg-zinc-100 text-xs font-semibold text-zinc-500 hover:bg-zinc-200 active:cursor-grabbing dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      aria-label={dragLabel}
      title={dragLabel}
    >
      ↕
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
    >
      {children(dragHandle)}
    </div>
  );
}
