"use client";

import { useEffect, useId, useState } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { CSSProperties, SyntheticEvent } from "react";
import { sortingCollisionDetection, sortingKeyboardCoordinates, sortingMoveEdit } from "@/lib/sorting-dnd";
import { useSortingOrder } from "@/lib/hooks/use-sorting-order";
import { SortableContext, rectSortingStrategy, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import type { Question, SortingQuestion } from "@/types/quiz";
import { parseSortingOrder } from "@/types/sorting";
import StageMedia from "./room/stage-media";
import { PanelIcon } from "./room/panel-icon";

type SortingLayout = "list" | "columns";

function SortingMedia({ media, label }: { media: NonNullable<Question["media"]>; label: string }) {
  const [result, setResult] = useState<{ path: string; url?: string; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDownloadURL(ref(getStorage(getFirebaseClientApp()), media.storagePath)).then(
      (url) => { if (!cancelled) setResult({ path: media.storagePath, url }); },
      () => { if (!cancelled) setResult({ path: media.storagePath, error: "Unable to load item media." }); },
    );
    return () => { cancelled = true; };
  }, [media.storagePath]);
  if (result?.path !== media.storagePath) return <p>Loading media…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return <StageMedia url={result.url!} fallbackName={media.filename ?? media.originalPath ?? media.storagePath}
    alt={label} mediaVolume={0.2} playbackActive={false}
    imageWrapperClassName="w-full" imageClassName="max-h-40 w-full rounded-lg object-contain"
    videoClassName="max-h-40 w-full" />;
}

export function SortingQuestionContent({ item, index, layout = "list" }: { item: SortingQuestion; index: number; layout?: SortingLayout }) {
  return <div className="min-w-0 flex-1 space-y-2">
    {item.text ? <p className={`whitespace-pre-wrap text-sm ${layout === "columns" ? "font-semibold" : "font-normal"}`}>{item.text}</p> : null}
    {item.media ? <SortingMedia media={item.media} label={item.text ?? `Item ${index + 1}`} /> : null}
  </div>;
}

const itemClassName = "relative flex items-start gap-3 rounded-[5px] bg-zinc-100 p-1.5 ring-1 ring-inset ring-zinc-400/40 dark:bg-zinc-900/60";

function orderListProps(layout: SortingLayout, count: number) {
  return layout === "columns" ? {
    className: "grid grid-cols-1 gap-4 @lg/sorting:grid-flow-col @lg/sorting:grid-cols-2 @lg/sorting:[grid-template-rows:var(--sorting-rows)]",
    style: { "--sorting-rows": `repeat(${Math.ceil(count / 2)}, minmax(48px, auto))` } as CSSProperties,
  } : { className: "space-y-2" };
}

function SortableSortingItem({ item, index, disabled, layout }: { item: SortingQuestion; index: number; disabled: boolean; layout: SortingLayout }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const activate = (event: SyntheticEvent, kind: "onMouseDown" | "onTouchStart") => {
    const target = event.target;
    if (target instanceof Element && !target.closest("[data-sorting-handle]") &&
        target.closest("button, a, input, textarea, select, audio, video, [contenteditable='true']")) return;
    listeners?.[kind]?.(event);
  };
  const columns = layout === "columns";
  return <li ref={setNodeRef} data-item-id={item.id} data-dragging={isDragging} className={`${columns ? "relative flex min-w-0 items-start gap-4" : itemClassName} ${disabled ? "" : "touch-pan-y cursor-grab active:cursor-grabbing"} ${!columns && !disabled ? "hover:bg-zinc-300/50 dark:hover:bg-zinc-800/60" : ""} ${isDragging ? "z-10 shadow-lg outline-2 outline-emerald-500" : ""}`}
    style={{ transform: CSS.Translate.toString(transform), transition }}
    onMouseDown={(event) => activate(event, "onMouseDown")} onTouchStart={(event) => activate(event, "onTouchStart")}
    onDragStart={(event) => event.preventDefault()}>
    {columns ? <span className="flex h-12 w-4 shrink-0 items-center text-sm font-semibold" aria-hidden="true">{index + 1}.</span> : null}
    <div className={columns ? "flex min-h-12 min-w-0 flex-1 items-start gap-4 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-3 hover:bg-zinc-200/80 dark:border-zinc-700 dark:bg-zinc-800" : "contents"}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} onKeyDown={(event) => listeners?.onKeyDown?.(event)} data-sorting-handle
      aria-label={`Reorder item ${index + 1}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      title="Drag to reorder"
      className="relative inline-flex size-5 shrink-0 cursor-inherit items-center justify-center rounded-sm before:absolute before:-inset-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-emerald-500 aria-disabled:opacity-30">
      {columns ? <PanelIcon name="drag" className="dark:invert" /> : <Image src="/sorting-grip.svg" alt="" width={20} height={20} className="pointer-events-none" />}
    </button>
    <SortingQuestionContent item={item} index={index} layout={layout} />
    </div>
  </li>;
}

function SortableSortingItems({ items, order, onMove, disabled, layout }: {
  items: SortingQuestion[]; order: readonly string[]; onMove: (from: number, to: number) => void; disabled: boolean; layout: SortingLayout;
}) {
  const contextId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortingKeyboardCoordinates(order) }),
  );
  const position = (id: string | number) => order.indexOf(String(id)) + 1;
  return <DndContext id={contextId} sensors={sensors} collisionDetection={sortingCollisionDetection}
    accessibility={{
      screenReaderInstructions: { draggable: "Press space to pick up an item, use the up and down arrow keys to choose its position, then press space to drop. Press escape to cancel." },
      announcements: {
        onDragStart: ({ active }) => `Picked up item ${position(active.id)}.`,
        onDragOver: ({ over }) => over ? `Over position ${position(over.id)}.` : "Outside the sorting list.",
        onDragEnd: ({ over }) => over ? `Dropped at position ${position(over.id)}.` : "Reordering cancelled.",
        onDragCancel: () => "Reordering cancelled.",
      },
    }}
    onDragEnd={({ active, over }) => {
      if (disabled || !over || active.id === over.id) return;
      const from = order.indexOf(String(active.id)), to = order.indexOf(String(over.id));
      if (from >= 0 && to >= 0) onMove(from, to);
    }}>
    <SortableContext items={[...order]} strategy={layout === "columns" ? rectSortingStrategy : verticalListSortingStrategy}>
      <ol {...orderListProps(layout, order.length)} aria-label="Sorting order">
        {order.map((id, index) => <SortableSortingItem key={id} item={items.find((item) => item.id === id)!} index={index} disabled={disabled} layout={layout} />)}
      </ol>
    </SortableContext>
  </DndContext>;
}

export function SortingQuestions({ items, order, onMove, disabled = true, layout = "list" }: {
  items: SortingQuestion[]; order: readonly string[]; onMove?: (from: number, to: number) => void; disabled?: boolean; layout?: SortingLayout;
}) {
  if (onMove) return <div className="@container/sorting"><SortableSortingItems items={items} order={order} onMove={onMove} disabled={disabled} layout={layout} /></div>;
  return <div className="@container/sorting"><ol {...orderListProps(layout, order.length)} aria-label="Sorting order">
    {order.map((id, index) => <li key={id} data-item-id={id} className={layout === "columns" ? "flex min-w-0 items-start gap-4" : itemClassName}>
      {layout === "columns" ? <span className="flex h-12 w-4 shrink-0 items-center text-sm font-semibold" aria-hidden="true">{index + 1}.</span> : null}
      <div className={layout === "columns" ? "flex min-h-12 min-w-0 flex-1 items-start rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-700" : "contents"}>
        <SortingQuestionContent item={items.find((item) => item.id === id)!} index={index} layout={layout} />
      </div>
    </li>)}
  </ol></div>;
}

export function SortingRound({ roomSlug, teamId, roundId, criterion, questions, startingOrder, state, readOnly = false, reveal = false, layout = "list", hideCriterion = false }: {
  roomSlug?: string; teamId?: string; roundId: string; criterion: string; questions: SortingQuestion[]; startingOrder?: string[];
  state: "active" | "closed"; readOnly?: boolean; reveal?: boolean; layout?: SortingLayout; hideCriterion?: boolean;
}) {
  const { getToken, user } = useFirebaseAuth();
  const itemIds = questions.map((question) => question.id);
  const [correct, setCorrect] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idsKey = JSON.stringify(itemIds);
  const sync = useSortingOrder({ roomSlug, teamId, roundId, itemIds, uid: user?.uid, getToken,
    enabled: state === "active" && !readOnly && questions.length >= 2, closed: state === "closed" });
  useEffect(() => {
    if (!reveal || state !== "closed" || !roomSlug || questions.length < 2) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "rounds", roundId, "answers", "order"), (snapshot) => {
      try { setCorrect(parseSortingOrder(snapshot.data()?.correctOrder, JSON.parse(idsKey))); }
      catch { setError("Invalid correct sorting order."); }
    }, () => setError("Unable to load the correct order."));
  }, [reveal, state, roomSlug, roundId, idsKey, questions.length]);

  if (questions.length < 2) return <p>Loading sorting items…</p>;
  const order = sync.order ?? (startingOrder ? parseSortingOrder(startingOrder, itemIds) : itemIds);
  const disabled = readOnly || state !== "active" || sync.closed || sync.order === null;
  return <div className="min-h-0 space-y-3 overflow-auto p-2 [scrollbar-gutter:stable]">
    {!hideCriterion ? <h2 className="whitespace-pre-wrap font-semibold">{criterion}</h2> : null}
    {error ? <p role="alert" className="text-red-500">{error} <button type="button" className="underline" onClick={() => setError(null)}>Dismiss</button></p> : null}
    {sync.error && !readOnly ? <p role="alert" className="text-red-500">{sync.error} <button type="button" className="underline" onClick={sync.retry}>{sync.pendingCount ? "Retry saving" : "Dismiss"}</button></p> : null}
    {reveal && state === "closed" ? <section className="space-y-2" aria-label="Correct order">
      <h3 className="font-semibold">Correct order</h3>
      {correct ? <SortingQuestions items={questions} order={correct} layout={layout} /> : <p>Loading correct order…</p>}
    </section> : <SortingQuestions items={questions} order={order} disabled={disabled} layout={layout} onMove={readOnly || state === "closed" ? undefined : (from, to) => {
      const edit = sortingMoveEdit(order, from, to);
      if (edit) sync.move(edit);
    }} />}
  </div>;
}
