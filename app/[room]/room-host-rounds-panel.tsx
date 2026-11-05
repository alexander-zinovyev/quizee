"use client";

import { useMemo, useState } from "react";
import {
  getVisibleHostQuestions,
  resolveHostRoundId,
  type HostRound,
} from "./host-rounds";

type RoomHostRoundsPanelProps = {
  rounds: HostRound[];
  className?: string;
  presenting?: {
    round?: string | null;
    question?: string | null;
  } | null;
  onPresentQuestion?: (roundId: string, questionId: string) => void;
  onHideQuestion?: () => void;
  onStartRound?: (roundId: string) => void;
  onEndRound?: (roundId: string) => void;
  onGradeRound?: (roundId: string) => void;
};

export default function RoomHostRoundsPanel({
  rounds,
  className,
  presenting,
  onPresentQuestion,
  onHideQuestion,
  onStartRound,
  onEndRound,
  onGradeRound,
}: RoomHostRoundsPanelProps) {
  const sanitizedRounds = useMemo(
    () => rounds.slice().sort((a, b) => a.order - b.order),
    [rounds]
  );
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const activeId = resolveHostRoundId(sanitizedRounds, selectedRoundId);

  const activeRound =
    sanitizedRounds.find((round) => round.id === activeId) ??
    sanitizedRounds[0];
  const visibleQuestions = activeRound ? getVisibleHostQuestions(activeRound) : [];

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
          const indicatorColor =
            round.state === "active"
              ? "bg-emerald-500"
              : round.state === "closed"
                ? "bg-red-500"
                : "bg-amber-400";
          return (
            <button
              key={round.id}
              onClick={() => setSelectedRoundId(round.id)}
              title={round.title}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 transition ${
                isActive
                  ? "bg-emerald-500 text-white shadow-sm"
                  : "text-emerald-600 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              }`}
              type="button"
            >
              <span className="flex h-2.5 w-2.5 rounded-full border border-white/70 dark:border-emerald-950/60">
                <span className={`h-full w-full rounded-full ${indicatorColor}`} />
              </span>
              R{round.roundNumber}
            </button>
          );
        })}
      </div>

      <div className="relative flex-1 overflow-hidden rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
            Round #{activeRound.roundNumber}
          </p>
          <div className="flex items-center gap-2">
            {activeRound.state === "scheduled" ? (
              <button
                type="button"
                onClick={() => onStartRound?.(activeRound.id)}
                className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1"
              >
                Activate
              </button>
            ) : null}
            {activeRound.type === "sorting" && activeRound.state === "closed" && activeRound.gradingRequired ? (
              <button type="button" onClick={() => onGradeRound?.(activeRound.id)} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Score round</button>
            ) : null}
            {activeRound.state === "active" ? (
              <button
                type="button"
                onClick={() => onEndRound?.(activeRound.id)}
                className="rounded-md bg-red-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
              >
                End
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex h-full flex-col gap-3 overflow-auto pr-2">
          {visibleQuestions.map((question) => (
              <div
                key={question.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                    {question.order + 1}. {question.prompt}
                  </p>
                  {(activeRound.state === "active" || activeRound.state === "closed") && (
                    <button
                      type="button"
                      onClick={() => {
                        const isPresented =
                          presenting?.round === activeRound.id &&
                          presenting?.question === question.id;
                        if (isPresented) {
                          onHideQuestion?.();
                        } else {
                          onPresentQuestion?.(activeRound.id, question.id);
                        }
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
                      title={
                        presenting?.round === activeRound.id &&
                        presenting?.question === question.id
                          ? "Hide question"
                          : "Show question"
                      }
                    >
                      {presenting?.round === activeRound.id &&
                      presenting?.question === question.id ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="h-4 w-4"
                        >
                          <path d="M3 3l18 18" strokeLinecap="round" />
                          <path d="M4.5 4.5C3 6 2 8 2 12c2 3 5.6 6 10 6 2.1 0 4-.5 5.6-1.4M9.88 9.88a3 3 0 104.24 4.24" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="h-4 w-4"
                        >
                          <path
                            d="M2 12c2-3 5.6-6 10-6s8 3 10 6c-2 3-5.6 6-10 6s-8-3-10-6z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <circle cx="12" cy="12" r="2.5" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                  {question.answer || "—"}
                </p>
              </div>
            ))}
          {!visibleQuestions.length ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No questions available.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
