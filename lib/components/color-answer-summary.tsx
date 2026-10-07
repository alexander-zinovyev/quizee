"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import type { Question } from "@/types/quiz";

export function ColorAnswerSummary({ roomSlug, roundId, teamId, questions }: {
  roomSlug?: string; roundId: string; teamId?: string; questions: Question[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!roomSlug || !teamId) return;
    return onSnapshot(collection(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers"),
      (snapshot) => setAnswers(Object.fromEntries(snapshot.docs.map((answer) => [answer.id, answer.data().answer]))),
      (e) => setError(e.message));
  }, [roomSlug, teamId, roundId]);
  return <div className="min-h-0 overflow-auto">
    {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}
    {questions.map((question, index) => {
      const color = answers[String(question.id)] ?? question.initialColor;
      return <div key={question.id ?? index} className="flex flex-wrap items-center gap-2 border-b border-zinc-200 py-2 text-sm dark:border-zinc-700">
        <span className="min-w-0 flex-1">Question {index + 1}</span>
        <span aria-label={color} className="h-6 w-6 shrink-0 rounded border border-zinc-400" style={{ backgroundColor: color }} />
        <span className="font-mono text-xs">{color}</span>
      </div>;
    })}
  </div>;
}
