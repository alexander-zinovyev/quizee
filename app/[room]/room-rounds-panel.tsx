"use client";

import { useMemo, useState } from "react";
import QuizRound from "@/lib/components/quiz-round";
import type { QuizRoundData } from "@/types/quiz";

type RoomRoundsPanelProps = {
  rounds: QuizRoundData[];
  roomSlug?: string;
  teamId?: string | null;
  className?: string;
};

export default function RoomRoundsPanel({
  rounds,
  roomSlug,
  teamId,
  className,
}: RoomRoundsPanelProps) {
  const sanitizedRounds = useMemo(() => rounds, [rounds]);
  const [activeId, setActiveId] = useState<string | null>(
    sanitizedRounds[0]?.id ?? null,
  );
  const activeRound =
    sanitizedRounds.find((round) => round.id === activeId) ??
    sanitizedRounds[0];

  if (!activeRound) {
    return (
      <section
        className={`flex h-full w-full flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 bg-white/70 p-6 text-center text-sm font-semibold uppercase tracking-[0.25em] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 ${className ?? ""}`}
      >
        All rounds finished
      </section>
    );
  }

  return (
    <div className={`flex h-full w-full flex-col ${className ?? ""}`}>
      <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-emerald-200 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
        {sanitizedRounds.map((round) => {
          const isActive = round.id === activeRound.id;
          return (
            <button
              key={round.id}
              onClick={() => setActiveId(round.id)}
              className={`shrink-0 rounded-full px-3 py-1 transition ${
                isActive
                  ? "bg-emerald-500 text-white shadow-sm"
                  : "text-emerald-600 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              }`}
              type="button"
            >
              {round.title}
            </button>
          );
        })}
      </div>

      <div className="relative flex-1 overflow-hidden">
        {activeRound ? (
          <QuizRound
            key={activeRound.id}
            {...activeRound}
            roomSlug={roomSlug}
            teamId={teamId ?? undefined}
            className={`${activeRound.className ?? ""} h-full`}
          />
        ) : null}
      </div>
    </div>
  );
}
