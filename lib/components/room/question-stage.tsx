"use client";

import type { ComponentProps } from "react";
import StageMedia, { inferMediaKindFromName } from "./stage-media";

/** Shared layout for a question stage, including a clue round's general clue. */
export function QuestionStage({ text, mediaName, mediaUrl, mediaKind, hasMedia, loading = false, error, mediaVolume = 1, playbackActive = true, fillMedia = false }: {
  text?: string | null; mediaName?: string | null; mediaUrl?: string | null; hasMedia: boolean;
  mediaKind?: ComponentProps<typeof StageMedia>["kind"]; loading?: boolean; error?: string | null;
  mediaVolume?: number; playbackActive?: boolean; fillMedia?: boolean;
}) {
  const kind = mediaKind ?? inferMediaKindFromName(mediaName);
  const image = hasMedia && kind.isImage;
  const content = hasMedia ? <>
    {loading ? <p role="status" className="text-sm text-zinc-300">Loading media…</p> : mediaUrl ? <StageMedia
      url={mediaUrl} kind={kind} fallbackName={mediaName} alt={mediaName ?? "Question media"} label={text ?? undefined}
      mediaVolume={mediaVolume} playbackActive={playbackActive} zoomLabel="Zoom question image"
      imageWrapperClassName={text ? "mb-4 w-full md:float-right md:mb-3 md:ml-6 md:w-1/3 md:max-w-[33%]" : fillMedia ? "h-full max-h-full max-w-full" : "w-full"}
      imageClassName={fillMedia && !text ? "h-auto max-h-full w-auto max-w-full rounded-2xl object-contain" : "max-h-[55vh] w-full rounded-2xl object-contain"}
      mediaClassName={fillMedia ? "h-full w-full rounded-2xl bg-black object-contain" : "max-h-[55vh] w-full rounded-2xl bg-black object-contain"}
      audioClassName="w-full" /> : null}
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
  </> : null;
  const prompt = text ? <h2 className="whitespace-pre-wrap text-3xl font-semibold leading-tight text-white">{text}</h2> : null;
  return <div className={fillMedia ? "flex h-full min-h-0 w-full items-center justify-center" : image ? "w-full" : "w-full space-y-6"}>
    {image ? <>{content}{prompt}{text ? <div className="clear-both" /> : null}</> : <>{prompt}{content}</>}
  </div>;
}
