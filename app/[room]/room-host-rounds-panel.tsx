"use client";

import type { ReactNode } from "react";
import { PanelIcon } from "@/lib/components/room/panel-icon";
import { SortingQuestions } from "@/lib/components/sorting-round";
import ZoomableImage from "@/lib/components/zoomable-image";
import { getHostSortingView, getVisibleHostQuestions, type HostRound } from "./host-rounds";

export type RoomHostRoundsPanelProps = {
  rounds: HostRound[];
  selectedRoundId: string | null;
  className?: string;
  presenting?: {
    round?: string | null;
    question?: string | null;
    withAnswer?: boolean;
  } | null;
  pending?: boolean;
  onPresentQuestion?: (roundId: string, questionId: string) => void;
  onHideQuestion?: () => void;
  onStartRound?: (roundId: string) => void;
  onEndRound?: (roundId: string) => void;
  onGradeRound?: (roundId: string) => void;
  onRevealRound?: (roundId: string, withAnswer: boolean) => void;
};

function HostImages({ round }: { round: HostRound }) {
  return <div className="grid grid-cols-2 justify-items-center gap-x-8 gap-y-8 px-2 py-2 @min-[600px]:grid-cols-4" aria-label="Round images">
    {(round.images ?? []).map((image) => {
      const question = round.questions.find((entry) => entry.answer === String(image.id));
      return <figure key={image.id} className="flex w-full min-w-0 max-w-[152px] flex-col items-center gap-2">
        <ZoomableImage src={image.src} alt={image.alt ?? "Quiz image"} label={question?.prompt}
          wrapperClassName="w-full overflow-hidden rounded-[7px] border border-black/70 dark:border-zinc-600"
          imageClassName="aspect-[2/1] w-full object-contain"
          zoomOverlay zoomIcon={<PanelIcon name="zoom" tone="white" />} />
        <figcaption className="w-full whitespace-pre-wrap break-words text-center text-sm font-semibold text-black dark:text-zinc-100">
          {question?.prompt || "No description"}
        </figcaption>
      </figure>;
    })}
    {!round.images?.length ? <p className="col-span-full text-sm text-zinc-500">Loading round images…</p> : null}
  </div>;
}

export default function RoomHostRoundsPanel({
  rounds,
  selectedRoundId,
  className,
  presenting,
  pending = false,
  onPresentQuestion,
  onHideQuestion,
  onStartRound,
  onEndRound,
  onGradeRound,
  onRevealRound,
}: RoomHostRoundsPanelProps) {
  const round = rounds.find((entry) => entry.id === selectedRoundId);
  if (!round) return <p className="p-4 text-sm text-zinc-500">Select a round.</p>;
  const visibleQuestions = getVisibleHostQuestions(round);
  const isRevealing = presenting?.round === round.id && presenting.withAnswer === true;
  const buttonClass = "rounded-lg px-5 py-1.5 text-sm font-semibold leading-5 text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60";
  let action: ReactNode = null;
  if (round.state === "scheduled") {
    action = <button type="button" disabled={pending} onClick={() => onStartRound?.(round.id)} className={`${buttonClass} bg-[#00e000] hover:bg-green-400`}>Activate</button>;
  } else if (round.state === "active") {
    action = <button type="button" disabled={pending} onClick={() => onEndRound?.(round.id)} className={`${buttonClass} bg-[#ef0000] text-white hover:bg-red-600`}>End round</button>;
  } else if (round.type === "image" || round.type === "sorting") {
    action = <button type="button" disabled={pending} onClick={() => onRevealRound?.(round.id, !isRevealing)} className={`${buttonClass} bg-[#ff9d00] hover:bg-amber-400`}>{isRevealing ? "Hide answers" : "Show answers"}</button>;
  }

  const sortingView = round.type === "sorting" ? getHostSortingView(round) : null;

  return <section aria-label={`Host round: ${round.title}`} className={`@container flex h-full min-h-0 w-full flex-col px-3 py-3 text-black dark:text-zinc-100 ${className ?? ""}`}>
    <header className="mb-2 grid shrink-0 grid-cols-[1fr_auto] items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800 @min-[600px]:grid-cols-[180px_minmax(0,1fr)_180px]">
      <div className="hidden @min-[600px]:block" aria-hidden="true" />
      <h2 className="min-w-0 break-words text-center text-sm font-semibold leading-8">{round.type === "sorting" ? round.criterion ?? round.title : round.title}</h2>
      <div className="flex flex-wrap items-center justify-end gap-2">{action}</div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      {round.type === "image" ? <HostImages round={round} /> : round.type === "sorting" ? (
        <div className="p-2">{sortingView ? <SortingQuestions items={sortingView.items} order={sortingView.order} layout="columns" /> : <p role="status" className="text-sm text-zinc-500">Loading sorting items…</p>}</div>
      ) : <div className="space-y-4 p-2">
        {visibleQuestions.map((question) => {
          const isPresented = presenting?.round === round.id && presenting?.question === question.id;
          return <article key={question.id} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <p className="min-w-0 whitespace-pre-wrap break-words px-1 py-1 text-sm font-semibold leading-4">{question.order + 1}. {question.prompt}</p>
              {round.state !== "scheduled" ? <button type="button" disabled={pending}
                aria-label={`${isPresented ? "Hide" : "Show"} question ${question.order + 1}`}
                title={isPresented ? "Hide question" : "Show question"}
                aria-pressed={isPresented}
                onClick={() => isPresented ? onHideQuestion?.() : onPresentQuestion?.(round.id, question.id)}
                className={`flex size-[42px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-60 ${isPresented ? "bg-red-500 hover:bg-red-600" : "bg-[#2cc852] hover:bg-green-600"}`}>
                <PanelIcon name={isPresented ? "eye-slash" : "eye"} tone="white" />
              </button> : null}
            </div>
            <p className="rounded-lg bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">{question.answer || "No text answer"}</p>
          </article>;
        })}
        {!visibleQuestions.length ? <p className="text-sm text-zinc-500">No questions available.</p> : null}
      </div>}
    </div>
    {round.state === "closed" && round.gradingRequired && (round.type === "sorting" || round.type === "image" || round.type === "color") ? <div className="shrink-0 pt-2 text-right">
      <button type="button" disabled={pending} onClick={() => onGradeRound?.(round.id)} className={`${buttonClass} bg-emerald-500 text-white`}>Retry scoring</button>
    </div> : null}
  </section>;
}
