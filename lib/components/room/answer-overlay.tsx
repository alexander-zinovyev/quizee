"use client";

import type { ComponentProps } from "react";
import StageMedia from "./stage-media";

/** Revealed answers sit above the question without replacing its presentation or playback state. */
export function AnswerOverlay({ text, mediaUrl, mediaName, mediaKind, loading = false, error, mediaVolume = 1 }: {
  text?: string | null;
  mediaUrl?: string | null;
  mediaName?: string | null;
  mediaKind?: ComponentProps<typeof StageMedia>["kind"];
  loading?: boolean;
  error?: string | null;
  mediaVolume?: number;
}) {
  if (!text && !mediaUrl && !loading && !error) return null;
  return <section aria-label="Revealed answer" className="absolute inset-[10%] z-10 flex items-center justify-center">
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-emerald-200/80 bg-emerald-700/98 px-8 py-6 text-center text-3xl font-semibold leading-tight text-white shadow-2xl">
      <div className={`grid h-full w-full min-h-0 items-stretch gap-6 ${text && (mediaUrl || loading || error) ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-2 md:grid-rows-[minmax(0,1fr)]" : "grid-cols-1 grid-rows-[minmax(0,1fr)]"}`}>
        {text ? <span className="block max-h-full self-center overflow-auto whitespace-pre-wrap break-words">{text}</span> : null}
        {mediaUrl ? <div className="flex h-full min-h-0 w-full self-stretch items-center justify-center">
          <StageMedia url={mediaUrl} kind={mediaKind} fallbackName={mediaName} alt="Answer media" label={text ?? undefined}
            mediaVolume={mediaVolume} imageWrapperClassName="max-h-full max-w-full" imageClassName="rounded-2xl"
            fitImageToParent zoomLabel="Zoom answer image" mediaClassName="h-full max-h-full w-full rounded-2xl object-contain" audioClassName="w-full" />
        </div> : loading ? <p role="status" className="self-center text-sm text-emerald-100">Loading answer…</p>
          : error ? <p role="alert" className="self-center text-sm text-red-100">{error}</p> : null}
      </div>
    </div>
  </section>;
}
