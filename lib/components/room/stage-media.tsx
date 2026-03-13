"use client";

import ZoomableImage from "@/lib/components/zoomable-image";

type MediaKind = {
  isAudio: boolean;
  isImage: boolean;
  isVideo: boolean;
};

function inferMediaKindFromName(name: string | null | undefined): MediaKind {
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
}) {
  const resolvedKind =
    kind && (kind.isAudio || kind.isImage || kind.isVideo)
      ? kind
      : inferMediaKindFromName(fallbackName ?? url);

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
      />
    );
  }

  if (resolvedKind.isVideo) {
    return (
      <video
        src={url}
        className={videoClassName ?? mediaClassName}
        controls
        playsInline
        autoPlay
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = mediaVolume;
        }}
      />
    );
  }

  if (resolvedKind.isAudio) {
    return (
      <audio
        src={url}
        className={audioClassName ?? "w-full"}
        controls
        autoPlay
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = mediaVolume;
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
