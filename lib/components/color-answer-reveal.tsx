"use client";

import { useState } from "react";
import { ColorImage, type ColorArtwork } from "./color-image";
import { ColorImageIndicator } from "./color-image-indicator";

export function ColorAnswerReveal({ artwork, submittedColor, targetColor, submissions }: {
  artwork: ColorArtwork; submittedColor: string; targetColor: string;
  submissions: Array<{ id: string; name: string; color?: string | null }>;
}) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const comparing = hovered || held || focused;

  return (
    <div className={`grid h-full min-h-0 min-w-0 gap-4 ${submissions.length ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @3xl:grid-cols-2 @3xl:grid-rows-[minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"}`}>
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
        <span className="relative block h-full" aria-hidden={!comparing}>
          <ColorImage artwork={artwork} color={submittedColor} label="Submitted answer" className="block h-full w-full object-contain" />
          <ColorImageIndicator version="team" hidden={!comparing} />
        </span>
        <span className="color-answer-correct-layer absolute inset-0 block" style={{ clipPath: comparing ? "inset(0 0 0 50%)" : "inset(0)" }}>
          <span className="color-answer-transition relative block h-full" style={{ animation: revealed ? "none" : undefined }} onAnimationEnd={() => setRevealed(true)}>
            <ColorImage artwork={artwork} color={targetColor} label="Correct answer" className="block h-full w-full object-contain" />
            <ColorImageIndicator version="original" />
          </span>
        </span>
        <span aria-hidden="true" className="color-answer-fold" style={{ animation: revealed ? "none" : undefined }} />
        <span aria-hidden="true" className="color-answer-comparison-edge" style={{ left: comparing ? "50%" : "0%", opacity: comparing ? 1 : 0 }} />
      </button>
      {submissions.length ? <section aria-label="Other teams' submissions" className="min-h-0 min-w-0 overflow-y-auto">
        <div className="grid h-full auto-rows-[minmax(min(100%,128px),1fr)] grid-cols-1 gap-4 @3xl:grid-cols-2">
          {submissions.map((team) => <figure key={team.id} className="flex min-h-0 min-w-0 flex-col">
            <figcaption className="mb-2 shrink-0 break-words text-center text-sm font-semibold text-zinc-100">{team.name}</figcaption>
            <div className="min-h-0 flex-1">{team.color ? <ColorImage artwork={artwork} color={team.color} label={`${team.name}'s answer`} className="block h-full w-full object-contain" />
              : <p className="text-center text-sm text-zinc-300" role={team.color === undefined ? "status" : undefined}>{team.color === undefined ? "Loading submission..." : "No final submission"}</p>}</div>
          </figure>)}
        </div>
      </section> : null}
    </div>
  );
}
