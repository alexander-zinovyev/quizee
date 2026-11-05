"use client";

import { useEffect, useState } from "react";
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

export function SortingItems({ items, order, onMove, disabled = true }: {
  items: SortingItem[]; order: readonly string[]; onMove?: (from: number, to: number) => void; disabled?: boolean;
}) {
  return <ol className="space-y-2" aria-label="Sorting order">
    {order.map((id, index) => {
      const item = items.find((candidate) => candidate.id === id)!;
      return <li key={id} data-item-id={id} className="flex items-start gap-3 rounded-xl border border-zinc-400/40 p-3">
        <span className="text-sm font-semibold">{index + 1}.</span>
        <div className="min-w-0 flex-1 space-y-2">
          {item.stages.map((stage, stageIndex) => <div key={stageIndex} className="space-y-2">
            {stage.text ? <p className="whitespace-pre-wrap text-sm">{stage.text}</p> : null}
            {stage.media ? <SortingMedia media={stage.media} label={stage.text ?? `Item ${index + 1}`} /> : null}
          </div>)}
        </div>
        {onMove ? <div className="flex shrink-0 flex-col gap-1">
          <button type="button" aria-label={`Move item ${id} up`} disabled={disabled || index === 0}
            className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => onMove(index, index - 1)}>↑</button>
          <button type="button" aria-label={`Move item ${id} down`} disabled={disabled || index === order.length - 1}
            className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => onMove(index, index + 1)}>↓</button>
        </div> : null}
      </li>;
    })}
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
  return <div className="min-h-0 space-y-3 overflow-auto p-2">
    <h2 className="whitespace-pre-wrap font-semibold">{question.prompt}</h2>
    {error ? <p role="alert" className="text-red-500">{error} <button type="button" className="underline" onClick={() => setError(null)}>Dismiss</button></p> : null}
    <SortingItems items={items} order={order} disabled={disabled} onMove={readOnly || state === "closed" ? undefined : (from, to) => {
      const next = [...order];
      next.splice(to, 0, next.splice(from, 1)[0]);
      void save(next);
    }} />
    {!readOnly && state === "active" ? <div className="flex items-center gap-3">
      <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={disabled} onClick={() => void save(order)}>Save order</button>
      <p role="status" className="text-xs">{pending ? "Saving…" : !saved ? "Loading team order…" : saved.order ? "Order saved" : "Reorder items or save this order to submit."}</p>
    </div> : null}
    {state === "closed" && teamId ? <p className="text-sm">{saved?.order ? "Submissions closed" : "No order submitted"}{saved?.points === undefined ? "" : ` · ${saved.points} / ${items.length} points`}</p> : null}
    {reveal && state === "closed" ? <section className="space-y-2" aria-label="Correct order">
      <h3 className="font-semibold">Correct order</h3>
      {correct ? <SortingItems items={items} order={correct} /> : <p>Loading correct order…</p>}
    </section> : null}
  </div>;
}
