"use client";

import { useEffect, useRef, useState } from "react";
import { collection, doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import type { Question, QuizRoundData } from "@/types/quiz";
import { isAnswerCommitted, latestAttempt, parseTeamAnswer, type AnswerMutation, type TeamAnswer } from "@/lib/answers";
import { AnswerWriteQueue, type PendingAnswer } from "@/lib/answer-write-queue";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { PanelIcon } from "./room/panel-icon";

type AnswerRoundProps = {
  type: "text" | "multi-step";
  questions: Question[];
  roomSlug?: string;
  roundId: string;
  teamId?: string;
  presenting?: QuizRoundData["presenting"];
  allowAnswerChanges?: boolean;
  allowWager?: boolean;
  embedded?: boolean;
  onAnswer?: (question: Question, answer: string) => void;
};

export function AnswerInputs({
  questions, type, presenting, roundId, allowAnswerChanges, allowWager, embedded = false, answers, pending, enabled, error, onChange,
}: AnswerRoundProps & {
  answers: Record<string, TeamAnswer>;
  pending: Record<string, PendingAnswer>;
  enabled: boolean;
  error: string | null;
  onChange: (questionId: string, mutation: AnswerMutation, expectedStep?: number) => void;
}) {
  const step = presenting?.promptPage ?? 0;
  return (
    <form className={`flex w-full flex-col gap-4 overflow-hidden ${embedded ? "min-h-0 flex-1" : "h-full"}`} onSubmit={(event) => event.preventDefault()}>
      {error ? <p role="alert" className="text-xs font-semibold text-red-500">{error}</p> : null}
      <div className={`min-h-0 flex-1 space-y-4 overflow-auto ${embedded ? "px-2 pb-2" : "pr-2"}`}>
        {questions.map((question, index) => {
          const key = String(question.id ?? `question-${index}`);
          const saved = answers[key];
          const value = { answer: saved?.answer ?? question.answer ?? "", locked: saved?.locked ?? false, wagered: saved?.wagered ?? false, ...pending[key] };
          const attempts = saved?.attempts ?? [];
          const latest = latestAttempt(attempts);
          const isMultiStep = type === "multi-step";
          const canEdit = enabled && (!isMultiStep || (
            typeof allowAnswerChanges === "boolean" &&
            presenting?.round === roundId && presenting.question === key && !presenting.withAnswer &&
            step > (question.finalizedStep ?? -1) && !isAnswerCommitted(allowAnswerChanges, attempts)
          ));
          return (
            <div key={key} className="flex items-center gap-3">
              <span className={`shrink-0 text-sm font-semibold ${embedded ? "w-4 text-zinc-950 dark:text-zinc-100" : "w-6 text-zinc-600 dark:text-zinc-300"}`}>{index + 1}.</span>
              {isMultiStep && latest ? (
                <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" title="Step">
                  {latest.step + 1}
                </span>
              ) : null}
              <div className={embedded ? "flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-1 focus-within:border-emerald-400 dark:border-zinc-700 dark:bg-zinc-950" : "contents"}>
              <input
                type="text"
                aria-label={`Answer ${index + 1}`}
                maxLength={10000}
                value={value.answer}
                disabled={!canEdit || value.locked}
                onChange={(event) => onChange(key, { answer: event.target.value }, isMultiStep ? step : undefined)}
                placeholder={embedded ? "Type your answer here..." : "Answer goes here"}
                className={embedded
                  ? "h-10 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-sm font-semibold text-zinc-700 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:text-zinc-400 dark:text-zinc-100"
                  : "min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/30"}
              />
              {type === "text" && allowWager ? (
                <button type="button" aria-label={`Double or nothing for answer ${index + 1}`}
                  aria-pressed={value.wagered} title="Double or nothing: correct +2, wrong −2"
                  disabled={!enabled || pending[key]?.wagered !== undefined}
                  onClick={() => onChange(key, { wagered: !value.wagered })}
                  className={embedded
                    ? `h-9 shrink-0 rounded px-1 text-sm font-semibold disabled:opacity-60 ${value.wagered ? "text-orange-500" : "text-zinc-400"}`
                    : `h-8 shrink-0 rounded-md border px-2 text-sm font-semibold disabled:opacity-60 ${value.wagered ? "border-amber-500 bg-amber-500 text-black" : "border-zinc-400 text-zinc-600 dark:text-zinc-300"}`}>
                  x2
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onChange(key, { locked: !value.locked }, isMultiStep ? step : undefined)}
                disabled={!canEdit || pending[key]?.locked !== undefined}
                className={embedded
                  ? `flex size-[42px] shrink-0 items-center justify-center rounded-full text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 ${value.locked ? "bg-zinc-400 hover:bg-zinc-500" : "bg-green-500 hover:bg-green-600"}`
                  : `flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-white transition disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-300 disabled:opacity-60 dark:disabled:border-zinc-700 dark:disabled:bg-zinc-700 ${value.locked ? "border-zinc-300 bg-zinc-500 hover:bg-zinc-400 dark:border-zinc-700 dark:bg-zinc-700" : "border-emerald-500 bg-emerald-500 hover:bg-emerald-400"}`}
                title={value.locked ? "Edit answer" : "Lock answer"}
              >
                {embedded ? <PanelIcon name={value.locked ? "pencil" : "check"} tone="white" /> : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <path d={value.locked ? "M4 20h4l10.5-10.5a1.5 1.5 0 00-3-3L5 17v3z" : "M5 13l4 4L19 7"} strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
              </button>
              </div>
            </div>
          );
        })}
      </div>
    </form>
  );
}

export default function AnswerRound(props: AnswerRoundProps) {
  const { roomSlug, roundId, teamId, onAnswer, questions } = props;
  const { getToken } = useFirebaseAuth();
  const [answers, setAnswers] = useState<Record<string, TeamAnswer>>({});
  const [pending, setPending] = useState<Record<string, PendingAnswer>>({});
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queues = useRef(new Map<string, AnswerWriteQueue>());

  useEffect(() => {
    if (!roomSlug || !teamId) return;
    const activeQueues = queues.current;
    const answersRef = collection(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers");
    let initial = true;
    const unsubscribe = onSnapshot(answersRef, { includeMetadataChanges: true }, (snapshot) => {
      try {
        const changes: Record<string, TeamAnswer> = {};
        const removed: string[] = [];
        snapshot.docChanges().forEach(({ doc: answer, type }) => {
          if (type === "removed") removed.push(answer.id);
          else changes[answer.id] = parseTeamAnswer(answer.data());
        });
        const reset = initial;
        initial = false;
        setAnswers((previous) => {
          const next = reset ? changes : { ...previous, ...changes };
          removed.forEach((id) => delete next[id]);
          return next;
        });
        setEnabled(!snapshot.metadata.fromCache);
      } catch {
        setError("Unable to load team answers.");
        setEnabled(false);
      }
    }, () => { setError("Unable to load team answers."); setEnabled(false); });
    return () => {
      unsubscribe();
      activeQueues.forEach((queue) => queue.dispose());
      activeQueues.clear();
    };
  }, [roomSlug, roundId, teamId]);

  function changeAnswer(questionId: string, mutation: AnswerMutation, expectedStep?: number) {
    if (!roomSlug || !teamId) return;
    setError(null);
    let queue = queues.current.get(questionId);
    if (!queue) {
      const answerRef = doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", questionId);
      queue = new AnswerWriteQueue({
        write: async (change, step) => {
          const token = await getToken();
          const response = await fetch(`/api/rooms/${roomSlug}/rounds/${roundId}/answers/${questionId}`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ teamId, ...change, ...(step === undefined ? {} : { expectedStep: step }) }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.message ?? "Answer changes were not saved.");
          }
          if (change.locked === true && onAnswer) {
            const saved = await response.json();
            const question = questions.find((item, index) => String(item.id ?? `question-${index}`) === questionId);
            if (question) onAnswer(question, saved.answer.trim());
          }
        },
        synchronize: async () => { await getDocFromServer(answerRef); },
        pending: (value) => setPending((previous) => {
          const next = { ...previous };
          if (value) next[questionId] = value;
          else delete next[questionId];
          return next;
        }),
        error: (saveError) => setError(saveError instanceof Error ? saveError.message : "Answer changes were not saved."),
      });
      queues.current.set(questionId, queue);
    }
    queue.enqueue(mutation, expectedStep);
  }

  return <AnswerInputs {...props} answers={answers} pending={pending} enabled={enabled} error={error} onChange={changeAnswer} />;
}
