"use client";

import type { ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableQuestionCard } from "./sortable-question-card";

export function SortableBuilderList<T extends { id: string }>({ items, onChange, dragLabel, children }: {
  items: T[]; onChange: (items: T[]) => void; dragLabel: (index: number) => string;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id), to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) throw new Error("Unknown builder item.");
    onChange(arrayMove(items, from, to));
  }}><SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
    <div className="space-y-3">{items.map((item, index) => <SortableQuestionCard key={item.id} id={item.id} dragLabel={dragLabel(index)}>
      {(handle) => children(item, index, handle)}
    </SortableQuestionCard>)}</div>
  </SortableContext></DndContext>;
}
