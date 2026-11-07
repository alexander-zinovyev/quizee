"use client";

import { useId, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { Question, ImageItem } from "@/types/quiz";
import { useImageMatches } from "@/lib/hooks/use-image-matches";
import ZoomableImage from "@/lib/components/zoomable-image";
import { PanelIcon } from "@/lib/components/room/panel-icon";

type ImageQuizRoundProps = {
  questions: Question[]; images: ImageItem[];
  onAnswer?: (question: Question, answer: ImageItem) => void;
  roomSlug?: string; teamId?: string; roundId?: string;
};

function descriptionLabel(question: Question, index: number) {
  return question.prompt?.trim() || `Description ${index + 1}`;
}

export default function ImageQuizRound({ questions, images, onAnswer, roomSlug, teamId, roundId }: ImageQuizRoundProps) {
  const questionIds = useMemo(() => questions.map((question, index) => String(question.id ?? `question-${index}`)), [questions]);
  const imageIds = useMemo(() => images.map((image) => String(image.id)), [images]);
  const { answers, enabled, pending, error, dismissError, edit } = useImageMatches({ roomSlug, teamId, roundId, questionIds, imageIds });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const instructionsId = useId();
  const disabled = !enabled || pending;

  function startDrag(event: DragEvent<HTMLButtonElement>, questionId: string) {
    if (disabled || answers[questionId]?.locked) { event.preventDefault(); return; }
    event.dataTransfer.setData("text/plain", questionId);
    event.dataTransfer.effectAllowed = "move";
    setSelectedId(questionId);
  }
  async function assign(questionId: string, imageId: string) {
    await edit({ type: "assign", questionId, imageId });
    setSelectedId(null);
  }
  function drop(event: DragEvent<HTMLButtonElement>, imageId: string) {
    event.preventDefault();
    setDragOverId(null);
    const questionId = event.dataTransfer.getData("text/plain");
    if (questionIds.includes(questionId)) void assign(questionId, imageId);
  }

  if (!questions.length) return null;
  return <article className="@container/matching relative flex h-full min-h-0 w-full flex-col" aria-label="Image matching" aria-busy={pending}>
    {pending ? <p role="status" className="absolute right-0 top-0 z-20 rounded bg-white/95 px-2 text-xs text-zinc-500 dark:bg-zinc-900">Saving matches…</p> : null}
    {error ? <p role="alert" className="mb-2 text-sm text-red-600">{error} <button type="button" onClick={dismissError} className="underline">Dismiss</button></p> : null}
    <p className="sr-only" id={instructionsId}>Drag a description to the dropzone below an image, or select a description and then select its dropzone. Select a matched description to move it.</p>
    {!images.length ? <p className="text-sm text-zinc-500">Loading matching images…</p> : null}
    <div className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-4">
      <div className="grid grid-cols-2 justify-items-center gap-x-4 gap-y-8 @[560px]/matching:grid-cols-4 @[560px]/matching:gap-x-0" aria-label="Matching images">
        {images.map((image, index) => {
          const imageId = imageIds[index];
          const questionId = questionIds.find((id) => answers[id]?.answer === imageId);
          const question = questionId ? questions[questionIds.indexOf(questionId)] : null;
          const label = question ? descriptionLabel(question, questionIds.indexOf(questionId!)) : "Unassigned";
          const locked = Boolean(questionId && answers[questionId]?.locked);
          return <div key={imageId} className="group/match min-w-0 w-full max-w-[152px]" data-image-id={imageId}>
            <ZoomableImage src={image.src} alt={image.alt ?? `Image ${index + 1}`} label={image.label}
              wrapperClassName="aspect-[2/1] w-full overflow-hidden rounded-md border border-black dark:border-zinc-600"
              imageClassName="h-full w-full object-contain"
              zoomOverlay zoomIcon={<PanelIcon name="zoom" tone="white" />} zoomLabel={`Zoom image ${index + 1}`} />
            <div className="relative mt-2">
              <button type="button" className={`min-h-6 w-full rounded-md text-center text-sm font-semibold leading-5 focus-visible:outline-2 focus-visible:outline-emerald-500 ${questionId ? "border border-transparent text-zinc-950 dark:text-zinc-100" : "border border-dashed border-zinc-600 text-zinc-400 dark:border-zinc-400"} ${dragOverId === imageId ? "bg-emerald-100 ring-2 ring-emerald-500" : ""} ${selectedId && selectedId === questionId ? "ring-2 ring-emerald-500" : ""}`}
                aria-label={`Drop description for image ${index + 1}: ${label}`}
                aria-describedby={instructionsId} aria-pressed={Boolean(questionId && selectedId === questionId)}
                disabled={disabled || locked} draggable={Boolean(questionId) && !disabled && !locked}
                onDragStart={(event) => { if (questionId) startDrag(event, questionId); }}
                onDragEnd={() => { setSelectedId(null); setDragOverId(null); }}
                onDragOver={(event) => { if (!disabled && !locked) { event.preventDefault(); setDragOverId(imageId); } }}
                onDragLeave={() => setDragOverId(null)} onDrop={(event) => drop(event, imageId)}
                onClick={() => {
                  if (selectedId && selectedId !== questionId) void assign(selectedId, imageId);
                  else if (questionId) setSelectedId(selectedId === questionId ? null : questionId);
                }}>
                {label}
              </button>
              {question?.media?.storagePath ? <ZoomableImage src={question.media.storagePath} alt={`Description media ${questionIds.indexOf(questionId!) + 1}`} zoomLabel="Zoom description media"
                imageClassName="max-h-16 w-full object-contain" /> : null}
              {questionId ? <div className="absolute right-0 top-full z-10 flex items-center gap-1 rounded bg-white px-1 opacity-0 shadow-sm group-hover/match:opacity-100 group-focus-within/match:opacity-100 dark:bg-zinc-900">
                <button type="button" aria-label={`${locked ? "Edit" : "Lock"} match for image ${index + 1}`} title={locked ? "Edit match" : "Lock match"}
                  disabled={disabled} className={`flex size-6 items-center justify-center rounded-full ${locked ? "bg-zinc-400" : "bg-green-500"} disabled:opacity-40`}
                  onClick={async () => {
                    const next = await edit({ type: "lock", questionId, locked: !locked });
                    if (next?.[questionId].locked) onAnswer?.(questions[questionIds.indexOf(questionId)], image);
                  }}><PanelIcon name={locked ? "pencil" : "check"} tone="white" /></button>
                <button type="button" disabled={disabled || locked} aria-label={`Clear match for image ${index + 1}`} className="px-1 py-1 text-xs text-zinc-600 disabled:opacity-40 dark:text-zinc-300"
                  onClick={async () => { const next = await edit({ type: "clear", questionId }); if (next) setSelectedId(null); }}>Clear</button>
              </div> : null}
            </div>
          </div>;
        })}
      </div>
    </div>
    <div className="flex max-h-[35%] shrink-0 flex-wrap items-center justify-center gap-y-2 overflow-y-auto border-t border-zinc-100 pt-2 pb-1 dark:border-zinc-800" aria-label="Available descriptions">
      {questions.map((question, index) => {
        const questionId = questionIds[index];
        if (answers[questionId]?.answer) return null;
        return <div key={questionId} className="flex items-center gap-1 border-l border-zinc-300 px-2 first:border-l-0">
        <button type="button" draggable={!disabled && !answers[questionId]?.locked} disabled={disabled || answers[questionId]?.locked}
          aria-pressed={selectedId === questionId} aria-label={`Select description: ${descriptionLabel(question, index)}`}
          className={`cursor-grab text-sm font-semibold focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:cursor-default disabled:opacity-50 ${selectedId === questionId ? "rounded bg-emerald-100 text-emerald-800" : "text-zinc-950 dark:text-zinc-100"}`}
          onDragStart={(event) => startDrag(event, questionId)} onDragEnd={() => { setSelectedId(null); setDragOverId(null); }}
          onClick={() => setSelectedId(selectedId === questionId ? null : questionId)}>{descriptionLabel(question, index)}</button>
          {question.media?.storagePath ? <ZoomableImage src={question.media.storagePath} alt={`Description media ${index + 1}`}
            wrapperClassName="max-w-20" imageClassName="max-h-16 w-full object-contain" zoomLabel={`Zoom description media ${index + 1}`}
            zoomOverlay zoomIcon={<PanelIcon name="zoom" tone="white" />} /> : null}
        </div>;
      })}
      {questionIds.every((id) => answers[id]?.answer) ? <p className="text-sm text-zinc-500">All descriptions assigned</p> : null}
    </div>
  </article>;
}
