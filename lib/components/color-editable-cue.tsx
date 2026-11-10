"use client";

import { memo, useEffect, useId, useRef, useState, type RefObject } from "react";
import { colorMaskWeight } from "@/lib/color";
import type { ColorArtwork, RasterColorArtwork } from "@/lib/media/color-artwork";
import { ColorSvgMask } from "./color-svg";

function RasterCue({ artwork }: { artwork: RasterColorArtwork }) {
  const mask = useRef<SVGImageElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = artwork.image.width;
    canvas.height = artwork.image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
      pixels.data.fill(255, pixel, pixel + 3);
      pixels.data[pixel + 3] = colorMaskWeight(artwork.mask.data, pixel) * artwork.image.data[pixel + 3];
    }
    context.putImageData(pixels, 0, 0);
    mask.current?.setAttribute("href", canvas.toDataURL());
  }, [artwork]);
  return <Cue artwork={artwork} rasterMask={mask} />;
}

function Cue({ artwork, rasterMask }: { artwork: ColorArtwork; rasterMask?: RefObject<SVGImageElement | null> }) {
  const [ready, setReady] = useState(artwork.kind === "svg");
  const id = `editable-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const viewBox = artwork.kind === "svg" ? artwork.root.attributes.viewBox : `0 0 ${artwork.image.width} ${artwork.image.height}`;
  const [x, y, width, height] = viewBox.split(/[\s,]+/).map(Number);
  return <svg aria-hidden="true" className="color-editable-cue" viewBox={viewBox}
    preserveAspectRatio={artwork.kind === "svg" ? artwork.root.attributes.preserveAspectRatio : undefined}>
    <defs>
      <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height}>
        {artwork.kind === "svg" ? <ColorSvgMask artwork={artwork} /> : <image ref={rasterMask} onLoad={() => setReady(true)} x={x} y={y} width={width} height={height} />}
      </mask>
      <linearGradient id={`${id}-shine`}>
        <stop offset="30%" stopColor="white" stopOpacity="0" />
        <stop offset="50%" stopColor="white" />
        <stop offset="70%" stopColor="white" stopOpacity="0" />
      </linearGradient>
    </defs>
    <g mask={`url(#${id}-mask)`}>
      <rect className="color-editable-cue-band" style={{ animationPlayState: ready ? "running" : "paused" }} x={x} y={y} width={width} height={height} fill={`url(#${id}-shine)`} />
    </g>
  </svg>;
}

export const ColorEditableCue = memo(function ColorEditableCue({ artwork }: { artwork: ColorArtwork }) {
  return artwork.kind === "svg" ? <Cue artwork={artwork} /> : <RasterCue artwork={artwork} />;
});
