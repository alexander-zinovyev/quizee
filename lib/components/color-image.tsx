"use client";

import { useEffect, useRef, useState } from "react";
import { recolorPixels } from "@/lib/color";
import { loadColorArtwork, type ColorArtwork } from "@/lib/media/color-artwork";
import { ColorEditableCue } from "./color-editable-cue";
import { ColorSvgImage } from "./color-svg";

export type { ColorArtwork } from "@/lib/media/color-artwork";

export function useColorArtwork(imageUrl: string | null, maskUrl: string | null) {
  const [state, setState] = useState<{ key: string; artwork?: ColorArtwork; error?: string } | null>(null);
  const key = `${imageUrl}|${maskUrl}`;
  useEffect(() => {
    if (!imageUrl || !maskUrl) return;
    let cancelled = false;
    loadColorArtwork(imageUrl, maskUrl).then((artwork) => {
      if (!cancelled) setState({ key, artwork });
    }).catch((error: Error) => { if (!cancelled) setState({ key, error: error.message }); });
    return () => { cancelled = true; };
  }, [imageUrl, maskUrl, key]);
  return state?.key === key ? state : null;
}

export function ColorImage({ artwork, color, original = false, highlightEditable = false, label = "Color question", className = "block max-h-[55vh] w-full object-contain" }: {
  artwork: ColorArtwork; color: string; original?: boolean; highlightEditable?: boolean; label?: string; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || artwork.kind === "svg") return;
    context.putImageData(original ? artwork.image : new ImageData(recolorPixels(artwork.image.data, artwork.mask.data, color), artwork.image.width, artwork.image.height), 0, 0);
  }, [artwork, color, original]);
  const showHighlight = highlightEditable && !original;
  const imageClass = showHighlight ? "block h-full w-full object-contain" : className;
  const image = artwork.kind === "svg" ? <ColorSvgImage artwork={artwork} color={color} original={original} label={label} className={imageClass} /> : <canvas ref={canvas} width={artwork.image.width} height={artwork.image.height}
    role="img" aria-label={label} className={imageClass} style={{ aspectRatio: `${artwork.image.width}/${artwork.image.height}` }} />;
  if (!showHighlight) return image;
  return <span className={`relative ${className}`}>
    {image}
    <ColorEditableCue artwork={artwork} />
  </span>;
}
