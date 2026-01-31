"use client";

import type { ReactNode } from "react";
import { QuizRoundData } from "@/types/quiz";
import ImageQuizRound from "./image-round";
import TextQuizRound from "./text-round";

export default function QuizRound(props: QuizRoundData) {
  const {
    title,
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
  } else if (props.type == "text") {
    const hydrationKey = props.questions
      .map((question) => {
        const baseKey = question.id ?? question.prompt;
        return `text:${baseKey}:${question.answer ?? ""}`;
      })
      .join("|");

    body = (
      <TextQuizRound
        key={hydrationKey}
        questions={props.questions}
        roomSlug={roomSlug}
        teamId={teamId}
        roundId={roundId}
        onAnswer={(question, answer) => props.onAnswer?.(question, answer)}
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
        key={hydrationKey}
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
      className={`flex h-full w-full flex-col rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 ${
        className ?? ""
      }`}
      aria-label={title}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
        ROUND #{roundNumber}
      </p>
      {body}
    </section>
  );
}
