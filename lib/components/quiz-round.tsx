"use client";

import type { ReactNode } from "react";
import { QuizRoundData } from "@/types/quiz";
import { SortingRound } from "./sorting-round";
import ImageQuizRound from "./image-round";
import AnswerRound from "./answer-round";
import { ColorAnswerSummary } from "./color-answer-summary";

export default function QuizRound(props: QuizRoundData & { embedded?: boolean }) {
  const {
    title,
    embedded = false,
    roundNumber,
    questions,
    className,
    emptyLabel = "No questions available for this round yet.",
    roomSlug,
    teamId,
    id: roundId,
  } = props;
  const questionCount = questions.length;

  let body: ReactNode;

  if (!questionCount) {
    body = (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
    );
  } else if (props.type === "sorting") {
    body = <SortingRound key={`${roomSlug}:${teamId}:${roundId}:${props.state}`} roomSlug={roomSlug} teamId={teamId}
      roundId={roundId} criterion={props.criterion} startingOrder={props.startingOrder} questions={props.questions} state={props.state}
      layout={embedded ? "columns" : "list"} hideCriterion={embedded}
      reveal={props.presenting?.round === roundId && props.presenting.withAnswer === true} />;
  } else if (props.type === "color") {
    body = <ColorAnswerSummary key={`${roomSlug}:${teamId}:${roundId}`} roomSlug={roomSlug} roundId={roundId} teamId={teamId} questions={questions} />;
  } else if (props.type === "text" || props.type === "multi-step") {
    const hydrationKey = props.questions
      .map((question) => {
        const baseKey = question.id ?? question.prompt;
        return `${props.type}:${baseKey}:${question.answer ?? ""}`;
      })
      .join("|");

    body = (
      <AnswerRound
        key={`${roomSlug}:${teamId}:${roundId}:${hydrationKey}`}
        embedded={embedded}
        type={props.type}
        questions={props.questions}
        roomSlug={roomSlug}
        teamId={teamId}
        roundId={roundId}
        presenting={props.presenting}
        allowWager={props.type === "text" && props.allowWager}
        allowAnswerChanges={props.type === "multi-step" ? props.allowAnswerChanges : undefined}
        onAnswer={props.type === "text" ? props.onAnswer : undefined}
      />
    );
  } else {
    const hydrationKey = props.questions
      .map((question) => {
        const baseKey = question.id ?? question.prompt;
        return `image:${baseKey}:${question.answer ?? ""}`;
      })
      .join("|");

    body = (
      <ImageQuizRound
        key={`${roomSlug}:${teamId}:${roundId}:${hydrationKey}`}
        questions={props.questions}
        images={props.images}
        roomSlug={roomSlug}
        teamId={teamId}
        roundId={roundId}
        onAnswer={(question, answer) => props.onAnswer?.(question, answer)}
      />
    );
  }

  return (
    <section
      className={`flex h-full min-h-0 w-full min-w-0 flex-col ${embedded ? "p-3" : "rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90"} ${
        className ?? ""
      }`}
      aria-label={title}
    >
      {embedded ? <header className="mb-2 flex min-h-8 shrink-0 items-center justify-center border-b border-zinc-100 pb-2 dark:border-zinc-800">
        <h2 className="text-center text-sm font-semibold text-black dark:text-zinc-100">{props.type === "sorting" ? props.criterion : title}</h2>
      </header> : <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
        ROUND #{roundNumber}
      </p>}
      {body}
    </section>
  );
}
