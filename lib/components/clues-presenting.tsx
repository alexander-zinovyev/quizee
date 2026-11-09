"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { CluesView } from "@/types/clues";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { PanelIcon } from "./room/panel-icon";
import { isQuestionMediaPlaybackActive } from "@/lib/media/presentation-playback";
import StageMedia from "./room/stage-media";

function Coins() { return <Image src="/clues/coins.svg" alt="" width={21} height={16} className="shrink-0" />; }

type PresentedStage = { text?: string | null; media?: { filename: string; url?: string }; loading?: boolean; error?: string | null };

function StageContent({ stage, mediaUrl, prominent = false, mediaVolume = 1, playbackActive = false }: {
  stage: { text?: string | null; media?: { filename: string }; loading?: boolean; error?: string | null }; mediaUrl?: string; prominent?: boolean; mediaVolume?: number; playbackActive?: boolean;
}) {
  return <div className={prominent ? "space-y-3" : "flex flex-wrap items-start gap-2"}>
    {prominent && stage.text ? <h2 className="whitespace-pre-wrap text-2xl font-semibold leading-snug">{stage.text}</h2> : null}
    {stage.loading ? <p role="status" className="text-sm text-zinc-300">Loading media…</p> : null}
    {stage.error ? <p role="alert" className="text-sm text-red-300">{stage.error}</p> : null}
    {stage.media && mediaUrl ? <StageMedia url={mediaUrl} fallbackName={stage.media.filename} alt="Clue media" mediaVolume={mediaVolume}
      playbackActive={playbackActive} imageWrapperClassName={prominent || !stage.text ? "w-full" : "w-1/3 shrink-0"}
      imageClassName={prominent ? "max-h-[45vh] w-full object-contain" : "max-h-36 w-full object-contain"}
      mediaClassName="max-h-[45vh] w-full rounded object-contain" audioClassName="w-full" /> : null}
    {!prominent && stage.text ? <p className="min-w-0 flex-1 whitespace-pre-wrap">{stage.text}</p> : null}
  </div>;
}

export function CluesQuestionView({ generalClue, startingCoins, view, mediaUrls = {}, isHost, closed, revealedClueIds, pending, onPurchase, onReveal, answer, mediaVolume = 1, loadingMedia = false }: {
  generalClue: PresentedStage; startingCoins: number; view: CluesView; mediaUrls?: Record<string, string>; isHost: boolean; closed: boolean;
  revealedClueIds: string[]; pending: boolean; onPurchase: (id: string) => void; onReveal: (ids: string[]) => void; answer?: PresentedStage; mediaVolume?: number; loadingMedia?: boolean;
}) {
  const questionMediaPlaybackActive = isQuestionMediaPlaybackActive({
    withAnswer: Boolean(answer), hasQuestionMedia: Boolean(generalClue.media), hasAnswerMedia: Boolean(answer?.media),
  });
  const allShown = view.clues.every((clue) => revealedClueIds.includes(clue.id));
  return <div className="space-y-6 p-4 text-white sm:p-5">
    <StageContent stage={generalClue} mediaUrl={generalClue.media?.url} mediaVolume={mediaVolume} playbackActive={questionMediaPlaybackActive} prominent />
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
          const visible = clue.content !== undefined && (isHost || clue.purchased || (closed && revealedClueIds.includes(clue.id)));
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
            {visible && clue.content ? <div className="p-2 text-sm leading-relaxed"><StageContent stage={{ ...clue.content, loading: loadingMedia && !!clue.content.media && !mediaUrls[clue.id] }} mediaUrl={mediaUrls[clue.id]} mediaVolume={mediaVolume} /></div>
              : <p className="px-3 py-2 text-xs text-zinc-500">Clue hidden</p>}
          </article>;
        })}
      </div>
    </div>
    {answer && (answer.text || answer.media || answer.loading || answer.error) ? <div className="rounded-xl border border-emerald-300/40 bg-emerald-900/30 p-4"><h3 className="text-xs uppercase tracking-widest text-emerald-300">Answer</h3><div className="mt-2"><StageContent stage={answer} mediaUrl={answer.media?.url} mediaVolume={mediaVolume} playbackActive prominent /></div></div> : null}
  </div>;
}

export function CluesPresenting({ roomSlug, round, question, teamId, isHost, revealedClueIds, pending, onReveal, answer, generalMedia, generalMediaLoading, generalMediaError, mediaVolume = 1 }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  revealedClueIds: string[]; pending: boolean; onReveal: (ids: string[]) => void; answer?: PresentedStage; generalMedia?: PresentedStage["media"]; generalMediaLoading?: boolean; generalMediaError?: string | null; mediaVolume?: number;
}) {
  const { getToken } = useFirebaseAuth();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ view: CluesView; mediaUrls: Record<string, string>; key: string; loadingMedia: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const revealKey = JSON.stringify(revealedClueIds);
  const key = JSON.stringify([roomSlug, round.id, question.id, teamId ?? null, isHost]);
  const mediaCache = useRef(new Map<string, string>());
  useEffect(() => {
    const cache = mediaCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, [key]);
  const endpoint = `/api/rooms/${roomSlug}/rounds/${round.id}/answers/${question.id}/clues`;
  useEffect(() => {
    if (!teamId || isHost) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "cluePurchases", teamId, "rounds", round.id),
      () => setRevision((value) => value + 1), (failure) => setError(failure.message));
  }, [roomSlug, round.id, teamId, isHost]);
  useEffect(() => {
    const controller = new AbortController();
    const cache = mediaCache.current;
    async function load() {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const response = await fetch(endpoint, { headers, signal: controller.signal, cache: "no-store" });
      const view = await response.json();
      if (!response.ok) throw new Error(view.message ?? "Unable to load clues.");
      if (!isHost && view.teamId !== (teamId ?? null)) throw new Error("Team changed. Reload the room.");
      if (controller.signal.aborted) return;
      const authorizedMedia = new Set((view as CluesView).clues.filter((clue) => clue.content?.media).map((clue) => clue.id));
      for (const [id, url] of cache) if (!authorizedMedia.has(id)) { URL.revokeObjectURL(url); cache.delete(id); }
      const mediaUrls = Object.fromEntries(cache);
      const missing = (view as CluesView).clues.filter((clue) => clue.content?.media && !cache.has(clue.id));
      setLoaded({ view, mediaUrls, key, loadingMedia: missing.length > 0 }); setError(null);
      await Promise.all(missing.map(async (clue) => {
        const media = await fetch(`${endpoint}/${clue.id}/media`, { headers, signal: controller.signal, cache: "no-store" });
        if (!media.ok) throw new Error("Unable to load clue media.");
        if (controller.signal.aborted) return;
        const blob = await media.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob); cache.set(clue.id, url); mediaUrls[clue.id] = url;
      }));
      if (!controller.signal.aborted) { setLoaded({ view, mediaUrls, key, loadingMedia: false }); setError(null); }
    }
    void load().catch((failure) => {
      if (!controller.signal.aborted) {
        setError(failure.message);
        setLoaded((current) => current?.key === key ? { ...current, loadingMedia: false } : current);
      }
    });
    return () => controller.abort();
  }, [endpoint, getToken, key, revision, teamId, isHost, round.state, revealKey]);
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
    {loaded?.key === key ? <CluesQuestionView key={key} generalClue={{ text: question.prompt, media: generalMedia, loading: generalMediaLoading, error: generalMediaError }} startingCoins={round.startingCoins!} view={loaded.view} mediaUrls={loaded.mediaUrls}
      isHost={isHost} closed={round.state === "closed"} revealedClueIds={revealedClueIds} pending={pending || buying}
      onPurchase={(id) => void purchase(id)} onReveal={onReveal} answer={answer} mediaVolume={mediaVolume} loadingMedia={loaded.loadingMedia} /> : !error ? <p role="status" className="p-5 text-white">Loading clues…</p> : null}
  </div>;
}
