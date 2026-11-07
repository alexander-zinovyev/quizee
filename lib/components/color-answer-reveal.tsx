"use client";

import { useState } from "react";
import { ColorImage, type ColorArtwork } from "./color-image";
import { ColorImageIndicator } from "./color-image-indicator";

export function ColorAnswerReveal({ artwork, submittedColor, targetColor, label = "Submitted answer", defaultVersion = "original" }: {
  artwork: ColorArtwork; submittedColor: string; targetColor: string;
  label?: string; defaultVersion?: "team" | "original";
}) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(defaultVersion === "team");
  const comparing = hovered || held || focused;
  const showTeam = defaultVersion === "team" || comparing;
  const showOriginal = defaultVersion === "original" || comparing;
  const comparisonPosition = comparing ? "50%" : defaultVersion === "original" ? "0%" : "100%";

  return (
    <button
      type="button"
      aria-label="Compare submitted image"
      aria-pressed={comparing}
      className="relative block h-full min-h-0 w-full cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-white"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") { setHovered(true); setRevealed(true); } }}
      onPointerLeave={() => { setHovered(false); setHeld(false); }}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") { setHeld(true); setRevealed(true); } }}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onFocus={(event) => {
        const keyboardFocus = event.currentTarget.matches(":focus-visible");
        setFocused(keyboardFocus);
        if (keyboardFocus) setRevealed(true);
      }}
      onBlur={() => { setFocused(false); setHeld(false); }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); setHeld(true); setRevealed(true); }
      }}
      onKeyUp={() => setHeld(false)}
    >
      <span className="relative block h-full" aria-hidden={!showTeam}>
        <ColorImage artwork={artwork} color={submittedColor} label={label} className="block h-full w-full object-contain" />
        <ColorImageIndicator version="team" hidden={!showTeam} />
      </span>
      <span className="color-answer-correct-layer absolute inset-0 block" aria-hidden={!showOriginal} style={{ clipPath: `inset(0 0 0 ${comparisonPosition})` }}>
        <span className="color-answer-transition relative block h-full" style={{ animation: revealed ? "none" : undefined }} onAnimationEnd={() => setRevealed(true)}>
          <ColorImage artwork={artwork} color={targetColor} label="Correct answer" className="block h-full w-full object-contain" />
          <ColorImageIndicator version="original" hidden={!showOriginal} />
        </span>
      </span>
      <span aria-hidden="true" className="color-answer-fold" style={{ animation: revealed ? "none" : undefined }} />
      <span aria-hidden="true" className="color-answer-comparison-edge" style={{ left: comparisonPosition, opacity: comparing ? 1 : 0 }} />
    </button>
  );
}
