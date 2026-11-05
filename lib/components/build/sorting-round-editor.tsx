"use client";

import type { ComponentType } from "react";
import type { MediaTreeFile } from "./media-tree-shared";
import type { Stage } from "./round-builder-panel";

export type BuildSortingItem = { id: string; stages: Stage[] };
export type SortingEditorValue = { criterion: string; items: BuildSortingItem[]; correctOrder: string[] };

export function SortingRoundEditor({ value, mediaFiles, onChange, createStage, StageEditor }: {
  value: SortingEditorValue;
  mediaFiles: MediaTreeFile[];
  onChange: (value: SortingEditorValue) => void;
  createStage: () => Stage;
  StageEditor: ComponentType<{ stage: Stage; mediaFiles: MediaTreeFile[]; onChange: (next: Stage) => void; onRemove?: () => void; title: string }>;
}) {
  const orderedItems = value.correctOrder.map((id) => value.items.find((item) => item.id === id)).filter((item): item is BuildSortingItem => Boolean(item));
  function updateItem(next: BuildSortingItem) {
    onChange({ ...value, items: value.items.map((item) => item.id === next.id ? next : item) });
  }
  function move(index: number, direction: number) {
    const correctOrder = [...value.correctOrder];
    [correctOrder[index], correctOrder[index + direction]] = [correctOrder[index + direction], correctOrder[index]];
    onChange({ ...value, correctOrder });
  }
  return <div className="space-y-3">
    <label className="block text-sm font-semibold">Sorting criterion
      <textarea aria-label="Sorting criterion" value={value.criterion} onChange={(event) => onChange({ ...value, criterion: event.target.value })}
        className="mt-1 block w-full rounded-md border border-zinc-300 bg-transparent p-2 dark:border-zinc-700" />
    </label>
    <p className="text-sm text-zinc-500">Arrange items below in the correct order. Players see a shuffled list and earn one point per correct position. All stages of each item are shown together.</p>
    {orderedItems.map((item, index) => <section key={item.id} aria-label={`Sorting item ${index + 1}`} className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="mr-auto font-semibold">Position {index + 1}</p>
        <button type="button" aria-label={`Move sorting item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button>
        <button type="button" aria-label={`Move sorting item ${index + 1} down`} disabled={index === orderedItems.length - 1} onClick={() => move(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button>
        <button type="button" aria-label={`Remove sorting item ${index + 1}`} onClick={() => onChange({ ...value, items: value.items.filter((entry) => entry.id !== item.id), correctOrder: value.correctOrder.filter((id) => id !== item.id) })} className="rounded border px-2 py-1 text-red-600">Remove item</button>
      </div>
      {item.stages.map((stage, stageIndex) => <StageEditor key={stage.id} stage={stage} title={`Item stage ${stageIndex + 1}`} mediaFiles={mediaFiles}
        onChange={(next) => updateItem({ ...item, stages: item.stages.map((entry) => entry.id === stage.id ? next : entry) })}
        onRemove={item.stages.length > 1 ? () => updateItem({ ...item, stages: item.stages.filter((entry) => entry.id !== stage.id) }) : undefined} />)}
      <button type="button" onClick={() => updateItem({ ...item, stages: [...item.stages, createStage()] })} className="rounded border px-2 py-1 text-sm">Add item stage</button>
    </section>)}
    <button type="button" onClick={() => {
      const item = { id: crypto.randomUUID(), stages: [createStage()] };
      onChange({ ...value, items: [...value.items, item], correctOrder: [...value.correctOrder, item.id] });
    }} className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Add sorting item</button>
  </div>;
}
