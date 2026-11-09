"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { CluesView } from "@/types/clues";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { PanelIcon } from "./room/panel-icon";
import ZoomableImage from "./zoomable-image";

function Coins() { return <Image src="/clues/coins.svg" alt="" width={21} height={16} className="shrink-0" />; }

export function CluesQuestionView({ prompt, startingCoins, view, images = {}, isHost, closed, revealedClueIds, pending, onPurchase, onReveal, answer }: {
  prompt: string; startingCoins: number; view: CluesView; images?: Record<string, string>; isHost: boolean; closed: boolean;
  revealedClueIds: string[]; pending: boolean; onPurchase: (id: string) => void; onReveal: (ids: string[]) => void; answer?: string | null;
}) {
  const allShown = view.clues.every((clue) => revealedClueIds.includes(clue.id));
  return <div className="space-y-6 p-4 text-white sm:p-5">
    <h2 className="whitespace-pre-wrap text-2xl font-semibold leading-snug">{prompt}</h2>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">Clues</h3>
        {isHost && closed ? <button type="button" disabled={pending} onClick={() => onReveal(allShown ? [] : view.clues.map((clue) => clue.id))}
          className="rounded-full border border-emerald-300 px-3 py-1 text-sm text-emerald-300 disabled:opacity-50">{allShown ? "Hide all clues" : "Show all clues"}</button> : null}
        <p className="flex items-center gap-2 text-sm font-semibold tracking-widest text-emerald-300"><Coins />
          {isHost ? `${startingCoins} starting coins` : <><span className="text-pink-500">{view.remainingCoins}</span> / {startingCoins} coins</>}
        </p>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        {view.clues.map((clue) => {
          const visible = clue.text !== undefined;
          const shown = revealedClueIds.includes(clue.id);
          return <article key={clue.id} aria-label={`${clue.category} clue`} className={`overflow-hidden rounded-lg border ${visible ? "border-emerald-400 bg-emerald-900/50" : "border-zinc-700 bg-zinc-900"}`}>
            <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
              <h4 className="min-w-0 font-semibold">{clue.category}</h4><span aria-hidden="true" className="h-5 w-px bg-white/15" /><Coins /><span>{clue.price}</span>
              <div className="ml-auto">
                {isHost ? closed ? <button type="button" disabled={pending} aria-pressed={shown} aria-label={`${shown ? "Hide" : "Show"} ${clue.category} clue`}
                  onClick={() => onReveal(shown ? revealedClueIds.filter((id) => id !== clue.id) : [...revealedClueIds, clue.id])}
                  className="rounded-full border border-emerald-300 px-3 py-0.5 text-sm text-emerald-300 disabled:opacity-50">{shown ? "Hide" : "Show"}</button>
                  : <span className="text-xs text-emerald-200">Host view</span>
                : clue.purchased ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-3 py-0.5 text-sm font-semibold text-black"><PanelIcon name="check" />Opened</span>
                : visible ? <span className="text-xs text-emerald-200">Shown by host</span>
                : !closed && view.teamId ? <button type="button" disabled={pending} onClick={() => onPurchase(clue.id)} className="rounded-full border border-emerald-400 bg-emerald-400/20 px-3 py-0.5 text-sm font-semibold text-emerald-300 disabled:opacity-50">Open for {clue.price}</button> : null}
              </div>
            </header>
            {visible ? <div className="flex items-start gap-2 p-2 text-sm leading-relaxed">
              {clue.image && images[clue.id] ? <ZoomableImage src={images[clue.id]} alt={`${clue.category} clue image`} wrapperClassName="w-1/3 shrink-0" imageClassName="max-h-36 w-full object-contain" /> : null}
              <p className="whitespace-pre-wrap">{clue.text}</p>
            </div> : <p className="px-3 py-2 text-xs text-zinc-500">Clue hidden</p>}
          </article>;
        })}
      </div>
    </div>
    {answer ? <div className="rounded-xl border border-emerald-300/40 bg-emerald-900/30 p-4"><h3 className="text-xs uppercase tracking-widest text-emerald-300">Answer</h3><p className="mt-2 whitespace-pre-wrap text-xl font-semibold">{answer}</p></div> : null}
  </div>;
}

export function CluesPresenting({ roomSlug, round, question, teamId, isHost, revealedClueIds, pending, onReveal, answer }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  revealedClueIds: string[]; pending: boolean; onReveal: (ids: string[]) => void; answer?: string | null;
}) {
  const { getToken } = useFirebaseAuth();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ view: CluesView; images: Record<string, string>; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const revealKey = JSON.stringify(revealedClueIds);
  const key = `${roomSlug}:${round.id}:${question.id}:${teamId}:${isHost}:${round.state}:${revealKey}`;
  const endpoint = `/api/rooms/${roomSlug}/rounds/${round.id}/answers/${question.id}/clues`;
  useEffect(() => {
    if (!teamId || isHost) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "cluePurchases", teamId, "rounds", round.id),
      () => setRevision((value) => value + 1), (failure) => setError(failure.message));
  }, [roomSlug, round.id, teamId, isHost]);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    async function load() {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const response = await fetch(endpoint, { headers, signal: controller.signal, cache: "no-store" });
      const view = await response.json();
      if (!response.ok) throw new Error(view.message ?? "Unable to load clues.");
      if (!isHost && view.teamId !== (teamId ?? null)) throw new Error("Team changed. Reload the room.");
      const images: Record<string, string> = {};
      await Promise.all((view as CluesView).clues.filter((clue) => clue.image).map(async (clue) => {
        const image = await fetch(`${endpoint}/${clue.id}/image`, { headers, signal: controller.signal, cache: "no-store" });
        if (!image.ok) throw new Error("Unable to load clue image.");
        if (controller.signal.aborted) return;
        const blob = await image.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob); urls.push(url); images[clue.id] = url;
      }));
      if (!controller.signal.aborted) { setLoaded({ view, images, key }); setError(null); }
    }
    void load().catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [endpoint, getToken, key, revision, teamId, isHost]);
  async function purchase(id: string) {
    setBuying(true); setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`${endpoint}/${id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ teamId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to purchase clue.");
      setRevision((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to purchase clue."); }
    finally { setBuying(false); }
  }
  return <div className="min-h-0 flex-1 overflow-auto bg-black">
    {error ? <p role="alert" className="px-5 pt-3 text-sm text-red-300">{error}</p> : null}
    {loaded?.key === key ? <CluesQuestionView prompt={question.prompt ?? question.displayPrompt} startingCoins={round.startingCoins!} view={loaded.view} images={loaded.images}
      isHost={isHost} closed={round.state === "closed"} revealedClueIds={revealedClueIds} pending={pending || buying}
      onPurchase={(id) => void purchase(id)} onReveal={onReveal} answer={answer} /> : !error ? <p role="status" className="p-5 text-white">Loading clues…</p> : null}
  </div>;
}
