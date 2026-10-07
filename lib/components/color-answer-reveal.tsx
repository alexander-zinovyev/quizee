"use client";

import { useState } from "react";
import { ColorImage, type ColorArtwork } from "./color-image";

export function ColorAnswerReveal({ artwork, submittedColor, targetColor }: {
  artwork: ColorArtwork; submittedColor: string; targetColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const comparing = hovered || held || focused;

  return (
    <button
      type="button"
      aria-label="Compare submitted image"
      aria-pressed={comparing}
      className="relative block w-full cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-white"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => { setHovered(false); setHeld(false); }}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setHeld(true); }}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
      onBlur={() => { setFocused(false); setHeld(false); }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHeld(true); }
      }}
      onKeyUp={() => setHeld(false)}
    >
      <span className="block" aria-hidden={!comparing}>
        <ColorImage artwork={artwork} color={submittedColor} label="Submitted answer" />
      </span>
      <span className="absolute inset-0 block" style={{ opacity: comparing ? 0 : 1 }} aria-hidden={comparing}>
        <span className="color-answer-transition block">
          <ColorImage artwork={artwork} color={targetColor} label="Correct answer" />
        </span>
      </span>
    </button>
  );
}
