"use client";

import type { ComponentType } from "react";
import type { MediaTreeFile } from "./media-tree-shared";
import type { Stage } from "./round-builder-panel";

export type BuildSortingQuestion = Stage;
export type SortingEditorValue = { criterion: string; questions: BuildSortingQuestion[]; correctOrder: string[] };

export function SortingRoundEditor({ value, mediaFiles, onChange, createStage, StageEditor }: {
  value: SortingEditorValue;
  mediaFiles: MediaTreeFile[];
  onChange: (value: SortingEditorValue) => void;
  createStage: () => Stage;
  StageEditor: ComponentType<{ stage: Stage; mediaFiles: MediaTreeFile[]; onChange: (next: Stage) => void; onRemove?: () => void; title: string }>;
}) {
  const orderedQuestions = value.correctOrder.map((id) => value.questions.find((question) => question.id === id)).filter((question): question is BuildSortingQuestion => Boolean(question));
  function updateQuestion(next: BuildSortingQuestion) {
    onChange({ ...value, questions: value.questions.map((question) => question.id === next.id ? next : question) });
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
    <p className="text-sm text-zinc-500">Arrange questions below in the correct order. Players see a shuffled list and earn one point per correct position.</p>
    {orderedQuestions.map((question, index) => <section key={question.id} aria-label={`Sorting question ${index + 1}`} className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="mr-auto font-semibold">Position {index + 1}</p>
        <button type="button" aria-label={`Move sorting question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button>
        <button type="button" aria-label={`Move sorting question ${index + 1} down`} disabled={index === orderedQuestions.length - 1} onClick={() => move(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button>
        <button type="button" aria-label={`Remove sorting question ${index + 1}`} onClick={() => onChange({ ...value, questions: value.questions.filter((entry) => entry.id !== question.id), correctOrder: value.correctOrder.filter((id) => id !== question.id) })} className="rounded border px-2 py-1 text-red-600">Remove question</button>
      </div>
      <StageEditor stage={question} title="Question content" mediaFiles={mediaFiles} onChange={updateQuestion} />
    </section>)}
    <button type="button" onClick={() => {
      const question = createStage();
      onChange({ ...value, questions: [...value.questions, question], correctOrder: [...value.correctOrder, question.id] });
    }} className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Add sorting question</button>
  </div>;
}
