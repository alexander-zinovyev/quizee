"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

type ZoomableImageProps = {
  src: string;
  alt: string;
  label?: string;
  wrapperClassName?: string;
  imageClassName?: string;
  zoomButtonClassName?: string;
  zoomLabel?: string;
  fitToParent?: boolean;
  onError?: () => void;
};

export default function ZoomableImage({
  src,
  alt,
  label,
  wrapperClassName,
  imageClassName,
  zoomButtonClassName,
  zoomLabel = "Zoom image",
  fitToParent = false,
  onError,
}: ZoomableImageProps) {
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!isZoomOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsZoomOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isZoomOpen]);

  useEffect(() => {
    if (!fitToParent) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      setNaturalSize({
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
    };
    probe.src = src;
    return () => {
      cancelled = true;
    };
  }, [fitToParent, src]);

  useEffect(() => {
    if (!fitToParent || !naturalSize || !wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    const parent = wrapper.parentElement;
    if (!parent) return;

    const recompute = () => {
      const maxWidth = parent.clientWidth;
      const maxHeight = parent.clientHeight;
      if (!maxWidth || !maxHeight) return;
      const scale = Math.min(
        maxWidth / naturalSize.width,
        maxHeight / naturalSize.height
      );
      const width = Math.max(1, Math.floor(naturalSize.width * scale));
      const height = Math.max(1, Math.floor(naturalSize.height * scale));
      setFitSize({ width, height });
    };

    recompute();
    const observer = new ResizeObserver(() => recompute());
    observer.observe(parent);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [fitToParent, naturalSize]);

  const overlay = isZoomOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={() => setIsZoomOpen(false)}
    >
      <div
        className="relative flex w-full max-w-5xl flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl"
          style={{ width: "min(90vw, 960px)", height: "min(90vh, 600px)" }}
        >
          <button
            type="button"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/80"
            aria-label="Close zoomed image"
            onClick={(event) => {
              event.stopPropagation();
              setIsZoomOpen(false);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="h-full w-full object-contain" onError={onError} />
        </div>
        {label ? <p className="text-sm text-white/80">{label}</p> : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={wrapperRef}
        className={`group relative inline-flex max-h-full max-w-full items-center justify-center ${
          wrapperClassName ?? ""
        }`}
        style={fitToParent && fitSize ? { width: fitSize.width, height: fitSize.height } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onError={onError}
          className={
            fitToParent
              ? `h-full w-full object-contain ${imageClassName ?? ""}`.trim()
              : imageClassName ??
                "h-auto max-h-full w-auto max-w-full rounded-2xl object-contain"
          }
        />
        <button
          type="button"
          className={`absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1.5 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/90 ${
            zoomButtonClassName ?? ""
          }`}
          aria-label={zoomLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsZoomOpen(true);
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
      {typeof document !== "undefined" && overlay
        ? createPortal(overlay, document.body)
        : null}
    </>
  );
}
