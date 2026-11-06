"use client";

import { useEffect, useId, useState } from "react";
import { closestCenter, pointerWithin, type CollisionDetection, type KeyboardCoordinateGetter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
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

const itemClassName = "relative flex items-start gap-3 rounded-[5px] bg-zinc-300/50 p-1.5 ring-1 ring-inset ring-zinc-400/40 dark:bg-zinc-800/60";

function SortableSortingItem({ item, index, disabled }: { item: SortingItem; index: number; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return <li ref={setNodeRef} data-item-id={item.id} className={`${itemClassName} ${isDragging ? "z-10 shadow-lg outline-2 outline-emerald-500" : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
      aria-label={`Reorder item ${index + 1}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      title="Drag to reorder"
      className="relative inline-flex size-5 shrink-0 touch-none cursor-grab items-center justify-center rounded-sm before:absolute before:-inset-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-emerald-500 active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-30">
      <Image src="/sorting-grip.svg" alt="" width={20} height={20} className="pointer-events-none" />
    </button>
    <SortingItemContent item={item} index={index} />
  </li>;
}

// Pointer drops follow the handle even when neighboring media cards have different heights.
const sortingCollisionDetection: CollisionDetection = (args) => {
  return args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);
};

function SortableSortingItems({ items, order, onMove, disabled }: {
  items: SortingItem[]; order: readonly string[]; onMove: (from: number, to: number) => void; disabled: boolean;
}) {
  const contextId = useId();
  // Center the dragged card on its neighbor so tall media cards cannot hide keyboard targets.
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { active, context }) => {
    const direction = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
    if (!direction || !context.collisionRect) return;
    event.preventDefault();
    const index = order.indexOf(String(context.over?.id ?? active));
    const targetId = order[index + direction];
    const target = targetId === undefined ? undefined : context.droppableRects.get(targetId);
    if (!target) return;
    return { x: target.left, y: target.top + (target.height - context.collisionRect.height) / 2 };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
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
  const { getToken } = useFirebaseAuth();
  const items = question.items ?? [];
  const itemIds = items.map((item) => item.id);
  const [saved, setSaved] = useState<{ order: string[] | null; points?: number } | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const [correct, setCorrect] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const questionId = String(question.id ?? "question-1");
  // Item content can refresh independently from the subscription's stable IDs.
  const idsKey = JSON.stringify(itemIds);
  useEffect(() => {
    if (!roomSlug || !teamId || items.length < 2) return;
    const path = state === "closed"
      ? ["rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers", questionId]
      : ["rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", questionId];
    return onSnapshot(doc(getClientFirestore(), path[0], ...path.slice(1)), (snapshot) => {
      try {
        const data = snapshot.data();
        const order = data?.answer === undefined || data.answer === "" ? null
          : parseSortingOrder(JSON.parse(data.answer), JSON.parse(idsKey));
        setSaved({ order, points: typeof data?.awardedPoints === "number" ? data.awardedPoints : undefined });
      } catch {
        setError("Invalid saved sorting order.");
      }
    }, () => setError("Unable to load the team order."));
  }, [roomSlug, teamId, roundId, questionId, state, idsKey, items.length]);

  useEffect(() => {
    if (!reveal || state !== "closed" || !roomSlug || items.length < 2) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "rounds", roundId, "answers", questionId), (snapshot) => {
      try { setCorrect(parseSortingOrder(snapshot.data()?.correctOrder, JSON.parse(idsKey))); }
      catch { setError("Invalid correct sorting order."); }
    }, () => setError("Unable to load the correct order."));
  }, [reveal, state, roomSlug, roundId, questionId, idsKey, items.length]);

  const order = pending ?? saved?.order ?? itemIds;
  const disabled = readOnly || state !== "active" || !saved || !!pending || !!error;
  async function save(order: string[]) {
    if (disabled || !roomSlug || !teamId) return;
    setPending(order);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/rooms/${roomSlug}/rounds/${roundId}/answers/${questionId}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId, answer: JSON.stringify(order) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message ?? "Unable to save the sorting order.");
      }
      await getDocFromServer(doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", questionId));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save the sorting order.");
    } finally { setPending(null); }
  }
  if (items.length < 2) return <p>Loading sorting items…</p>;
  return <div className="min-h-0 space-y-3 overflow-auto p-2 [scrollbar-gutter:stable]">
    <h2 className="whitespace-pre-wrap font-semibold">{question.prompt}</h2>
    {error ? <p role="alert" className="text-red-500">{error} <button type="button" className="underline" onClick={() => setError(null)}>Dismiss</button></p> : null}
    <SortingItems items={items} order={order} disabled={disabled} onMove={readOnly || state === "closed" ? undefined : (from, to) => {
      const next = [...order];
      next.splice(to, 0, next.splice(from, 1)[0]);
      void save(next);
    }} />
    {!readOnly && state === "active" ? <div className="flex items-center gap-3">
      <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={disabled} onClick={() => void save(order)}>Save order</button>
      <p role="status" aria-label="Order saving status" className="text-xs">{pending ? "Saving…" : !saved ? "Loading team order…" : saved.order ? "Order saved" : "Reorder items or save this order to submit."}</p>
    </div> : null}
    {state === "closed" && teamId ? <p className="text-sm">{saved?.order ? "Submissions closed" : "No order submitted"}{saved?.points === undefined ? "" : ` · ${saved.points} / ${items.length} points`}</p> : null}
    {reveal && state === "closed" ? <section className="space-y-2" aria-label="Correct order">
      <h3 className="font-semibold">Correct order</h3>
      {correct ? <SortingItems items={items} order={correct} /> : <p>Loading correct order…</p>}
    </section> : null}
  </div>;
}
