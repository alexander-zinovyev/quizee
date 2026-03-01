"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import type { Question } from "@/types/quiz";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type TextQuizRoundProps = {
  /**
   * Set of text questions supplied by QuizRound.
   */
  questions: Question[];
  roomSlug?: string;
  teamId?: string;
  roundId?: string;
  /**
   * Handler invoked when answers are submitted.
   */
  onAnswer?: (question: Question, answer: string) => void;
};

export default function TextQuizRound({
  questions,
  roomSlug,
  teamId,
  roundId,
  onAnswer,
}: TextQuizRoundProps) {
  const questionEntries = useMemo(
    () =>
      questions.map((question, index) => ({
        key: `${question.id ?? `question-${index}`}`,
        question,
        index,
      })),
    [questions]
  );

  const [responses, setResponses] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    questionEntries.forEach(({ key, question }) => {
      initial[key] = question.answer ?? "";
    });
    return initial;
  });
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const { user } = useFirebaseAuth();

  useEffect(() => {
    if (!roomSlug || !teamId || !roundId) return;
    const db = getClientFirestore();
    const answersRef = collection(db, "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers");

    const unsubscribe = onSnapshot(answersRef, (snapshot) => {
      const nextResponses: Record<string, string> = {};
      const nextLocks: Record<string, boolean> = {};

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const answer = typeof data.answer === "string" ? data.answer : "";
        const locked = Boolean(data.locked);

        nextResponses[docSnap.id] = answer;
        nextLocks[docSnap.id] = locked;
      });

      setResponses((prev) => ({ ...prev, ...nextResponses }));
      setLocks((prev) => ({ ...prev, ...nextLocks }));
    });

    return () => unsubscribe();
  }, [roomSlug, roundId, teamId]);

  if (!questions.length) return null;

  function handleInputChange(key: string, value: string) {
    setResponses((previous) => ({ ...previous, [key]: value }));
  }

  async function persistAnswer(questionId: string, locked: boolean) {
    if (!roomSlug || !teamId || !roundId) return;
    const db = getClientFirestore();
    const answer = (responses[questionId] ?? "").trim();
    const answerRef = doc(db, "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", questionId);
    await setDoc(
      answerRef,
      {
        answer,
        locked,
        user: user?.uid ?? null,
      },
      { merge: true }
    );
  }

  return (
    <form className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <div className="flex-1 min-h-0 space-y-4 overflow-auto pr-2">
        {questionEntries.map(({ key, question, index }) => (
          <div
            key={key}
            className="rounded-xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/70"
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-1 w-6 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                {index + 1}.
              </span>
              <div className="flex-1 space-y-2">
                {question.prompt ? (
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {question.prompt}
                  </p>
                ) : null}
                {question.media?.storagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={question.media.storagePath}
                    alt={`Prompt media ${index + 1}`}
                    className="max-h-36 w-full rounded-xl object-contain"
                  />
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={responses[key] ?? ""}
                onChange={(event) => handleInputChange(key, event.target.value)}
                onBlur={() => void persistAnswer(key, locks[key] ?? false)}
                placeholder="Answer goes here"
                disabled={locks[key]}
                className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/30"
              />
              <button
                type="button"
                onClick={() =>
                  void persistAnswer(key, locks[key] ? false : true).then(() => {
                    if (locks[key]) {
                      // unlocking: keep answer as-is
                    } else {
                      // locking: notify onAnswer
                      const answer = responses[key]?.trim() ?? "";
                      onAnswer?.(question, answer);
                    }
                  })
                }
                className={`flex h-8 w-8 items-center justify-center rounded-md border text-white transition ${
                  locks[key]
                    ? "border-zinc-300 bg-zinc-500 hover:bg-zinc-400 dark:border-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                    : "border-emerald-500 bg-emerald-500 hover:bg-emerald-400"
                }`}
                title={locks[key] ? "Edit answer" : "Submit answer"}
              >
                {locks[key] ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="h-4 w-4"
                  >
                    <path d="M4 20h4l10.5-10.5a1.5 1.5 0 00-3-3L5 17v3z" />
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
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </form>
  );
}
