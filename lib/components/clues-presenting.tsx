"use client";

import Image from "next/image";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseClientApp } from "@/lib/firebase/client";
import { useEffect, useRef, useState } from "react";
import type { CluesView } from "@/types/clues";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { useRoomClues } from "@/lib/hooks/use-room-clues";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { PanelIcon } from "./room/panel-icon";
import { isQuestionMediaPlaybackActive } from "@/lib/media/presentation-playback";
import { loadMediaResource, releaseMediaResource, type MediaResource } from "@/lib/media/media-resource";
import { QuestionStage } from "./room/question-stage";
import { AnswerOverlay } from "./room/answer-overlay";
import StageMedia from "./room/stage-media";

function Coins() { return <Image src="/clues/coins.svg" alt="" width={21} height={16} className="shrink-0" />; }

type PresentedStage = { text?: string | null; media?: { filename: string; url?: string }; loading?: boolean; error?: string | null };

function ClueContent({ stage, mediaUrl, mediaVolume = 1, playbackActive = false, onMediaError }: {
  stage: { text?: string | null; media?: { filename: string }; loading?: boolean; error?: string | null }; mediaUrl?: string; mediaVolume?: number; playbackActive?: boolean; onMediaError?: () => void;
}) {
  return <div className="flex flex-wrap items-start gap-2">
    {stage.loading ? <p role="status" className="text-sm text-zinc-300">Loading media…</p> : null}
    {stage.error ? <p role="alert" className="text-sm text-red-300">{stage.error}</p> : null}
    {stage.media && mediaUrl ? <StageMedia url={mediaUrl} fallbackName={stage.media.filename} alt="Clue media" mediaVolume={mediaVolume}
      playbackActive={playbackActive} imageWrapperClassName={!stage.text ? "w-full" : "w-1/3 shrink-0"}
      imageClassName="max-h-36 w-full object-contain" onError={onMediaError}
      mediaClassName="max-h-[45vh] w-full rounded object-contain" audioClassName="w-full" /> : null}
    {stage.text ? <p className="min-w-0 flex-1 whitespace-pre-wrap">{stage.text}</p> : null}
  </div>;
}

export function CluesQuestionView({ generalClue, startingCoins, view, mediaUrls = {}, isHost, closed, revealedClueIds, pending, onPurchase, onReveal, answer, mediaVolume = 1, loadingMedia = false, onMediaError }: {
  generalClue: PresentedStage; startingCoins: number; view: CluesView; mediaUrls?: Record<string, string>; isHost: boolean; closed: boolean;
  revealedClueIds: string[]; pending: boolean; onPurchase: (id: string) => void; onReveal: (ids: string[]) => void; answer?: PresentedStage; mediaVolume?: number; loadingMedia?: boolean; onMediaError?: (id: string) => void;
}) {
  const questionMediaPlaybackActive = isQuestionMediaPlaybackActive({
    withAnswer: Boolean(answer), hasQuestionMedia: Boolean(generalClue.media), hasAnswerMedia: Boolean(answer?.media),
  });
  const allShown = view.clues.every((clue) => revealedClueIds.includes(clue.id));
  return <div className="relative min-h-0 flex-1 text-white">
    <div className="h-full space-y-6 overflow-auto p-4 sm:p-5">
      <QuestionStage text={generalClue.text} hasMedia={Boolean(generalClue.media)} mediaName={generalClue.media?.filename}
        mediaUrl={generalClue.media?.url} loading={generalClue.loading} error={generalClue.error}
        mediaVolume={mediaVolume} playbackActive={questionMediaPlaybackActive} />
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
            const mediaUrl = Object.hasOwn(mediaUrls, clue.id) ? mediaUrls[clue.id] : undefined;
            return <article key={clue.id} aria-label={`${clue.category} clue`} className={`overflow-hidden rounded-lg border ${visible ? "border-emerald-400 bg-emerald-900/50" : "border-zinc-700 bg-zinc-900"}`}>
              <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
                <h4 className="min-w-0 font-semibold">{clue.category}</h4>{clue.price > 0 ? <><span aria-hidden="true" className="h-5 w-px bg-white/15" /><Coins /><span>{clue.price}</span></> : null}
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
              {visible && clue.content ? <div className="px-3 py-2 text-sm leading-relaxed"><ClueContent stage={{ ...clue.content, loading: loadingMedia && !!clue.content.media && !mediaUrl }} mediaUrl={mediaUrl} mediaVolume={mediaVolume} onMediaError={() => onMediaError?.(clue.id)} /></div>
                : <p className="px-3 py-2 text-xs text-zinc-500">Clue hidden</p>}
            </article>;
          })}
        </div>
      </div>
    </div>
    {answer ? <AnswerOverlay text={answer.text} mediaUrl={answer.media?.url} mediaName={answer.media?.filename}
      loading={answer.loading} error={answer.error} mediaVolume={mediaVolume} /> : null}
  </div>;
}

export function CluesPresenting({ roomSlug, round, question, teamId, isHost, revealedClueIds, pending, onReveal, answer, generalMedia, generalMediaLoading, generalMediaError, mediaVolume = 1 }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  revealedClueIds: string[]; pending: boolean; onReveal: (ids: string[]) => void; answer?: PresentedStage; generalMedia?: PresentedStage["media"]; generalMediaLoading?: boolean; generalMediaError?: string | null; mediaVolume?: number;
}) {
  const { getToken } = useFirebaseAuth();
  const { view, error: readError, key } = useRoomClues({ roomId: roomSlug, roundId: round.id, questionId: question.id, teamId, isHost,
    startingCoins: round.startingCoins!, pricing: round.pricing, metadata: question.clues ?? [], revealedClueIds: round.state === "closed" ? revealedClueIds : [] });
  const [loaded, setLoaded] = useState<{ mediaUrls: Record<string, string>; key: string; loadingMedia: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const mediaKey = JSON.stringify(view?.clues.filter((clue) => clue.content?.media).map((clue) => ({ id: clue.id, path: clue.content!.media!.storagePath })) ?? []);
  const mediaCache = useRef(new Map<string, MediaResource>());
  useEffect(() => {
    const cache = mediaCache.current;
    return () => { cache.forEach(releaseMediaResource); cache.clear(); };
  }, [key]);
  const endpoint = `/api/rooms/${roomSlug}/rounds/${round.id}/answers/${question.id}/clues`;
  useEffect(() => {
    const controller = new AbortController();
    const cache = mediaCache.current;
    async function load() {
      const assets: { id: string; path: string }[] = JSON.parse(mediaKey);
      const authorizedPaths = new Set(assets.map((asset) => asset.path));
      for (const [path, resource] of cache) if (!authorizedPaths.has(path)) { releaseMediaResource(resource); cache.delete(path); }
      const mediaUrls = Object.fromEntries(assets.flatMap(({ id, path }) => cache.has(path) ? [[id, cache.get(path)!.url]] : []));
      const missing = [...authorizedPaths].filter((path) => !cache.has(path));
      setLoaded({ mediaUrls, key, loadingMedia: missing.length > 0 }); setError(null);
      if (!missing.length) return;
      const storage = getStorage(getFirebaseClientApp());
      const results = await Promise.allSettled(missing.map(async (path) => {
        const downloadUrl = await getDownloadURL(ref(storage, path));
        if (controller.signal.aborted) return;
        const resource = await loadMediaResource(downloadUrl, controller.signal);
        if (controller.signal.aborted) { releaseMediaResource(resource); return; }
        cache.set(path, resource);
      }));
      if (controller.signal.aborted) return;
      setLoaded({ mediaUrls: Object.fromEntries(assets.flatMap(({ id, path }) => cache.has(path) ? [[id, cache.get(path)!.url]] : [])), key, loadingMedia: false });
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      setError(null);
    }
    void load().catch((failure) => {
      if (!controller.signal.aborted) {
        setError(failure.message);
        setLoaded((current) => current?.key === key ? { ...current, loadingMedia: false } : current);
      }
    });
    return () => controller.abort();
  }, [key, mediaKey]);
  async function purchase(id: string) {
    setBuying(true); setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`${endpoint}/${id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ teamId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to purchase clue.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to purchase clue."); }
    finally { setBuying(false); }
  }
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black">
    {error || readError ? <p role="alert" className="px-5 pt-3 text-sm text-red-300">{error ?? readError}</p> : null}
    {view ? <CluesQuestionView key={key} generalClue={{ text: question.prompt, media: generalMedia, loading: generalMediaLoading, error: generalMediaError }} startingCoins={round.startingCoins!} view={view} mediaUrls={loaded?.key === key ? loaded.mediaUrls : {}}
      isHost={isHost} closed={round.state === "closed"} revealedClueIds={revealedClueIds} pending={pending || buying}
      onPurchase={(id) => void purchase(id)} onReveal={onReveal} answer={answer} mediaVolume={mediaVolume} loadingMedia={loaded?.key !== key || loaded.loadingMedia} onMediaError={() => setError("Unable to load clue media.")} /> : !error && !readError ? <p role="status" className="p-5 text-white">Loading clues…</p> : null}
  </div>;
}
