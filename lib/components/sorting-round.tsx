"use client";

import { useEffect, useId, useState } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { SyntheticEvent } from "react";
import { sortingCollisionDetection, sortingKeyboardCoordinates, sortingMoveEdit } from "@/lib/sorting-dnd";
import { useSortingOrder } from "@/lib/hooks/use-sorting-order";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import type { Question, SortingItem } from "@/types/quiz";
import { parseSortingOrder } from "@/types/sorting";
import StageMedia from "./room/stage-media";

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

function SortingItemContent({ item, index }: { item: SortingItem; index: number }) {
  return <>
    <div className="min-w-0 flex-1 space-y-2">
      {item.stages.map((stage, stageIndex) => <div key={stageIndex} className="space-y-2">
        {stage.text ? <p className="whitespace-pre-wrap text-sm font-normal">{stage.text}</p> : null}
        {stage.media ? <SortingMedia media={stage.media} label={stage.text ?? `Item ${index + 1}`} /> : null}
      </div>)}
    </div>
  </>;
}

const itemClassName = "relative flex items-start gap-3 rounded-[5px] bg-zinc-100 p-1.5 ring-1 ring-inset ring-zinc-400/40 dark:bg-zinc-900/60";

function SortableSortingItem({ item, index, disabled }: { item: SortingItem; index: number; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const activate = (event: SyntheticEvent, kind: "onMouseDown" | "onTouchStart") => {
    const target = event.target;
    if (target instanceof Element && !target.closest("[data-sorting-handle]") &&
        target.closest("button, a, input, textarea, select, audio, video, [contenteditable='true']")) return;
    listeners?.[kind]?.(event);
  };
  return <li ref={setNodeRef} data-item-id={item.id} data-dragging={isDragging} className={`${itemClassName} ${disabled ? "" : "touch-pan-y cursor-grab hover:bg-zinc-300/50 active:cursor-grabbing dark:hover:bg-zinc-800/60"} ${isDragging ? "z-10 shadow-lg outline-2 outline-emerald-500" : ""}`}
    style={{ transform: CSS.Translate.toString(transform), transition }}
    onMouseDown={(event) => activate(event, "onMouseDown")} onTouchStart={(event) => activate(event, "onTouchStart")}
    onDragStart={(event) => event.preventDefault()}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} onKeyDown={(event) => listeners?.onKeyDown?.(event)} data-sorting-handle
      aria-label={`Reorder item ${index + 1}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      title="Drag to reorder"
      className="relative inline-flex size-5 shrink-0 cursor-inherit items-center justify-center rounded-sm before:absolute before:-inset-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-emerald-500 aria-disabled:opacity-30">
      <Image src="/sorting-grip.svg" alt="" width={20} height={20} className="pointer-events-none" />
    </button>
    <SortingItemContent item={item} index={index} />
  </li>;
}

function SortableSortingItems({ items, order, onMove, disabled }: {
  items: SortingItem[]; order: readonly string[]; onMove: (from: number, to: number) => void; disabled: boolean;
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
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      <ol className="space-y-2" aria-label="Sorting order">
        {order.map((id, index) => <SortableSortingItem key={id} item={items.find((item) => item.id === id)!} index={index} disabled={disabled} />)}
      </ol>
    </SortableContext>
  </DndContext>;
}

export function SortingItems({ items, order, onMove, disabled = true }: {
  items: SortingItem[]; order: readonly string[]; onMove?: (from: number, to: number) => void; disabled?: boolean;
}) {
  if (onMove) return <SortableSortingItems items={items} order={order} onMove={onMove} disabled={disabled} />;
  return <ol className="space-y-2" aria-label="Sorting order">
    {order.map((id, index) => <li key={id} data-item-id={id} className={itemClassName}>
      <SortingItemContent item={items.find((item) => item.id === id)!} index={index} />
    </li>)}
  </ol>;
}

export function SortingRound({ roomSlug, teamId, roundId, question, state, readOnly = false, reveal = false }: {
  roomSlug?: string; teamId?: string; roundId: string; question: Question;
  state: "active" | "closed"; readOnly?: boolean; reveal?: boolean;
}) {
  const { getToken, user } = useFirebaseAuth();
  const items = question.items ?? [];
  const itemIds = items.map((item) => item.id);
  const [saved, setSaved] = useState<{ order: string[] | null; points?: number } | null>(null);
  const [correct, setCorrect] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const questionId = String(question.id ?? "question-1");
  // Item content can refresh independently from the subscription's stable IDs.
  const idsKey = JSON.stringify(itemIds);
  const sync = useSortingOrder({ roomSlug, teamId, roundId, questionId, itemIds, uid: user?.uid, getToken,
    enabled: state === "active" && !readOnly && items.length >= 2, closed: state === "closed" });
  useEffect(() => {
    if (state !== "closed" || !roomSlug || !teamId || items.length < 2) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers", questionId), (snapshot) => {
      try {
        const data = snapshot.data();
        setSaved({ order: parseSortingOrder(JSON.parse(data?.answer), JSON.parse(idsKey)),
          points: typeof data?.awardedPoints === "number" ? data.awardedPoints : undefined });
      } catch { setError("Invalid saved sorting order."); }
    }, () => setError("Unable to load the team order."));
  }, [state, roomSlug, teamId, roundId, questionId, idsKey, items.length]);

  useEffect(() => {
    if (!reveal || state !== "closed" || !roomSlug || items.length < 2) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "rounds", roundId, "answers", questionId), (snapshot) => {
      try { setCorrect(parseSortingOrder(snapshot.data()?.correctOrder, JSON.parse(idsKey))); }
      catch { setError("Invalid correct sorting order."); }
    }, () => setError("Unable to load the correct order."));
  }, [reveal, state, roomSlug, roundId, questionId, idsKey, items.length]);

  const order = state === "closed" ? saved?.order ?? itemIds : sync.order ?? itemIds;
  const disabled = readOnly || state !== "active" || sync.closed || sync.order === null;
  if (items.length < 2) return <p>Loading sorting items…</p>;
  return <div className="min-h-0 space-y-3 overflow-auto p-2 [scrollbar-gutter:stable]">
    <h2 className="whitespace-pre-wrap font-semibold">{question.prompt}</h2>
    {error ? <p role="alert" className="text-red-500">{error} <button type="button" className="underline" onClick={() => setError(null)}>Dismiss</button></p> : null}
    {sync.error && !readOnly ? <p role="alert" className="text-red-500">{sync.error} <button type="button" className="underline" onClick={sync.retry}>{sync.pendingCount ? "Retry saving" : "Dismiss"}</button></p> : null}
    <SortingItems items={items} order={order} disabled={disabled} onMove={readOnly || state === "closed" ? undefined : (from, to) => {
      const edit = sortingMoveEdit(order, from, to);
      if (edit) sync.move(edit);
    }} />
    {!readOnly && state === "active" ? <p role="status" aria-label="Order saving status" className="text-xs">
      {sync.error ? "Changes not saved" : sync.status === "loading" ? "Loading team order…" : sync.pendingCount ? "Saving…" : "Order saved"}
    </p> : null}
    {state === "closed" && teamId ? <p className="text-sm">{saved?.order ? "Submissions closed" : "No order submitted"}{saved?.points === undefined ? "" : ` · ${saved.points} / ${items.length} points`}</p> : null}
    {reveal && state === "closed" ? <section className="space-y-2" aria-label="Correct order">
      <h3 className="font-semibold">Correct order</h3>
      {correct ? <SortingItems items={items} order={correct} /> : <p>Loading correct order…</p>}
    </section> : null}
  </div>;
}
