import type { RoundQuestionMedia } from "@/lib/hooks/use-room-rounds";

export type PackMediaReference = string | { path: string; durationSeconds?: number };
export type BuilderMedia = { mediaPath: string | null; durationSeconds?: number };

export function getMediaPath(media: PackMediaReference): string;
export function getMediaPath(media?: PackMediaReference): string | undefined;
export function getMediaPath(media?: PackMediaReference): string | undefined {
  return typeof media === "string" ? media : media?.path;
}

export function toBuilderMedia(media?: PackMediaReference): BuilderMedia {
  return {
    mediaPath: getMediaPath(media) ?? null,
    ...(typeof media === "object" && media.durationSeconds !== undefined ? { durationSeconds: media.durationSeconds } : {}),
  };
}

export function toPackMedia(stage: BuilderMedia): PackMediaReference | undefined {
  const path = stage.mediaPath?.trim();
  if (!path) return undefined;
  return stage.durationSeconds === undefined ? path : { path, durationSeconds: stage.durationSeconds };
}

export function toPreviewMedia(stage?: BuilderMedia): RoundQuestionMedia | null {
  const path = stage?.mediaPath;
  if (!path) return null;
  return {
    storagePath: path,
    filename: path.split("/").pop() ?? path,
    originalPath: path,
    ...(stage.durationSeconds !== undefined ? { durationSeconds: stage.durationSeconds } : {}),
  };
}
