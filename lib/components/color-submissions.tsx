"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ColorImage, type ColorArtwork } from "./color-image";
import { ColorAnswerReveal } from "./color-answer-reveal";
import { ColorImageIndicator } from "./color-image-indicator";

type Submission = { id: string; name: string; color?: string | null };

function SubmissionImage({ artwork, submission, targetColor, defaultVersion }: {
  artwork: ColorArtwork; submission: Submission; targetColor?: string | null; defaultVersion: "team" | "original";
}) {
  if (!submission.color) return <p role={submission.color === undefined ? "status" : undefined} className="p-2 text-center text-sm text-zinc-300">
    {submission.color === undefined ? "Loading submission..." : "No final submission"}
  </p>;
  const label = `${submission.name}'s answer`;
  if (targetColor) return <ColorAnswerReveal artwork={artwork} submittedColor={submission.color} targetColor={targetColor} label={label} defaultVersion={defaultVersion} />;
  return <div className="relative h-full min-h-0">
    <ColorImage artwork={artwork} color={submission.color} label={label} className="block h-full w-full object-contain" />
    <ColorImageIndicator version="team" />
  </div>;
}

export function ColorSubmissions({ artwork, ownSubmission, opponents, targetColor }: {
  artwork: ColorArtwork; ownSubmission: Submission; opponents: Submission[]; targetColor?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, opponents.findIndex((team) => team.id === selectedId));
  const opponent = opponents[selectedIndex];

  function select(direction: number) {
    setSelectedId(opponents[(selectedIndex + direction + opponents.length) % opponents.length].id);
  }

  return <div className="grid h-full min-h-0 min-w-0 grid-cols-2 grid-rows-[auto_minmax(0,1fr)] gap-y-2">
    <section aria-label="Your submission" className="row-span-2 grid min-h-0 min-w-0 grid-rows-subgrid pr-4">
      <div className="flex min-h-8 shrink-0 items-center justify-center">
        <h3 title={ownSubmission.name} className="line-clamp-2 break-words text-center text-sm font-semibold text-zinc-100">{ownSubmission.name}</h3>
      </div>
      <div className="min-h-0 flex-1"><SubmissionImage artwork={artwork} submission={ownSubmission} targetColor={targetColor} defaultVersion="original" /></div>
    </section>
    <section aria-label="Opponent submission" className="row-span-2 grid min-h-0 min-w-0 grid-rows-subgrid border-l border-zinc-700 pl-4">
      {opponent ? <>
        <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1">
          <button type="button" aria-label="Previous opponent" disabled={opponents.length < 2} onClick={() => select(-1)}
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
          <h3 title={opponent.name} aria-live="polite" className="line-clamp-2 break-words text-center text-sm font-semibold text-zinc-100">{opponent.name}</h3>
          <button type="button" aria-label="Next opponent" disabled={opponents.length < 2} onClick={() => select(1)}
            className="flex h-8 w-8 items-center justify-center rounded text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1"><SubmissionImage key={opponent.id} artwork={artwork} submission={opponent} targetColor={targetColor} defaultVersion="team" /></div>
      </> : <p className="p-2 text-center text-sm text-zinc-300">No other teams</p>}
    </section>
  </div>;
}
