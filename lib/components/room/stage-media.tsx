"use client";

import { useEffect, useRef } from "react";

import ZoomableImage from "@/lib/components/zoomable-image";

type MediaKind = {
  isAudio: boolean;
  isImage: boolean;
  isVideo: boolean;
};

export function inferMediaKindFromName(name: string | null | undefined): MediaKind {
  const lower = (name ?? "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  return {
    isImage: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext),
    isAudio: [".mp3", ".wav", ".ogg", ".m4a", ".aac"].includes(ext),
    isVideo: [".mp4", ".mov", ".webm"].includes(ext),
  };
}

export default function StageMedia({
  url,
  kind,
  fallbackName,
  alt,
  label,
  mediaVolume,
  imageWrapperClassName,
  imageClassName,
  zoomLabel,
  mediaClassName,
  audioClassName,
  videoClassName,
  fitImageToParent = false,
  playbackActive = true,
  onError,
}: {
  url: string;
  kind?: MediaKind;
  fallbackName?: string | null;
  alt: string;
  label?: string;
  mediaVolume: number;
  imageWrapperClassName?: string;
  imageClassName?: string;
  zoomLabel?: string;
  mediaClassName?: string;
  audioClassName?: string;
  videoClassName?: string;
  fitImageToParent?: boolean;
  playbackActive?: boolean;
  onError?: () => void;
}) {
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const resolvedKind =
    kind && (kind.isAudio || kind.isImage || kind.isVideo)
      ? kind
      : inferMediaKindFromName(fallbackName ?? url);

  useEffect(() => {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement || playbackActive) return;
    mediaElement.pause();
    try {
      mediaElement.currentTime = 0;
    } catch {
      // Some streams do not allow seeking before metadata is available.
    }
  }, [playbackActive, url]);

  if (resolvedKind.isImage) {
    return (
      <ZoomableImage
        src={url}
        alt={alt}
        label={label}
        wrapperClassName={imageWrapperClassName}
        imageClassName={imageClassName}
        zoomLabel={zoomLabel}
        fitToParent={fitImageToParent}
        onError={onError}
      />
    );
  }

  if (resolvedKind.isVideo) {
    return (
      <video
        ref={(element) => {
          mediaElementRef.current = element;
        }}
        src={url}
        className={videoClassName ?? mediaClassName}
        controls
        onError={onError}
        playsInline
        autoPlay={playbackActive}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = mediaVolume;
          if (!playbackActive) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }
        }}
      />
    );
  }

  if (resolvedKind.isAudio) {
    return (
      <audio
        ref={(element) => {
          mediaElementRef.current = element;
        }}
        src={url}
        className={audioClassName ?? "w-full"}
        controls
        onError={onError}
        autoPlay={playbackActive}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = mediaVolume;
          if (!playbackActive) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }
        }}
      />
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-sm text-emerald-300 underline">
      Open media
    </a>
  );
}
