"use client";

import { useEffect, useRef, useState } from "react";
import { recolorPixels } from "@/lib/color";

export type ColorArtwork = { image: ImageData; mask: ImageData };

async function readImage(url: string): Promise<ImageData> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16777216) throw new Error("Color image is empty or exceeds 16 megapixels.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function loadColorArtwork(imageUrl: string, maskUrl: string): Promise<ColorArtwork> {
  const [image, mask] = await Promise.all([readImage(imageUrl), readImage(maskUrl)]);
  if (image.width !== mask.width || image.height !== mask.height) throw new Error("Image and mask dimensions must match.");
  return { image, mask };
}

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

export function ColorImage({ artwork, color, original = false, label = "Color question", className = "block max-h-[55vh] w-full object-contain" }: {
  artwork: ColorArtwork; color: string; original?: boolean; label?: string; className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.putImageData(original ? artwork.image : new ImageData(recolorPixels(artwork.image.data, artwork.mask.data, color), artwork.image.width, artwork.image.height), 0, 0);
  }, [artwork, color, original]);
  return <canvas ref={canvas} width={artwork.image.width} height={artwork.image.height}
    role="img" aria-label={label} className={className} style={{ aspectRatio: `${artwork.image.width}/${artwork.image.height}` }} />;
}
