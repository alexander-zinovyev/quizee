"use client";

import { useState } from "react";
import { ColorImage, type ColorArtwork } from "./color-image";

export function ColorAnswerReveal({ artwork, submittedColor, targetColor }: {
  artwork: ColorArtwork; submittedColor: string; targetColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const comparing = hovered || held || focused;

  return (
    <button
      type="button"
      aria-label="Compare submitted image"
      aria-pressed={comparing}
      className="relative block w-full cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-white"
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
      <span className="block" aria-hidden={!comparing}>
        <ColorImage artwork={artwork} color={submittedColor} label="Submitted answer" />
      </span>
      <span className="color-answer-correct-layer absolute inset-0 block" style={{ clipPath: comparing ? "inset(0 0 0 50%)" : "inset(0)" }}>
        <span className="color-answer-transition block" style={{ animation: revealed ? "none" : undefined }} onAnimationEnd={() => setRevealed(true)}>
          <ColorImage artwork={artwork} color={targetColor} label="Correct answer" />
        </span>
      </span>
      <span aria-hidden="true" className="color-answer-fold" style={{ animation: revealed ? "none" : undefined }} />
      <span aria-hidden="true" className="color-answer-comparison-edge" style={{ left: comparing ? "50%" : "0%", opacity: comparing ? 1 : 0 }} />
    </button>
  );
}
