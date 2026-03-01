"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, setDoc, doc, serverTimestamp } from "firebase/firestore";

import { getClientFirestore } from "@/lib/firebase/client";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";

type TeamScoreBreakdownDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  roomSlug: string;
  teamId: string | null;
  teamName: string | null;
  isHost?: boolean;
  roundsMeta: RoundMeta[];
  roundQuestions: Record<string, RoundQuestion[]>;
  onPointsUpdated: (teamId: string) => Promise<void>;
};

type BreakdownQuestion = {
  questionId: string;
  order: number;
  prompt: string;
  answer: string;
  awardedPoints: number | null;
};

type BreakdownRound = {
  roundId: string;
  title: string;
  order: number;
  questions: BreakdownQuestion[];
};

export default function TeamScoreBreakdownDialog({
  isOpen,
  onClose,
  roomSlug,
  teamId,
  teamName,
  isHost,
  roundsMeta,
  roundQuestions,
  onPointsUpdated,
}: TeamScoreBreakdownDialogProps) {
  const [rows, setRows] = useState<BreakdownRound[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || !teamId) return;
    const activeTeamId = teamId;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const db = getClientFirestore();
        const sortedRounds = roundsMeta
          .filter((round) => round.state === "closed")
          .slice()
          .sort((a, b) => a.order - b.order);
        const loaded = await Promise.all(
          sortedRounds.map(async (round) => {
            const answersSnap = await getDocs(
              collection(
                db,
                "rooms",
                roomSlug,
                "rounds",
                round.id,
                "teamAnswers",
                activeTeamId,
                "answers"
              )
            );
            const answersByQuestion = new Map<
              string,
              { answer: string; awardedPoints: number | null }
            >();
            answersSnap.forEach((snap) => {
              const data = snap.data();
              answersByQuestion.set(snap.id, {
                answer: typeof data.answer === "string" ? data.answer : "",
                awardedPoints:
                  typeof data.awardedPoints === "number" ? Math.max(0, data.awardedPoints) : null,
              });
            });

            const questions = (roundQuestions[round.id] ?? [])
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((question, idx) => {
                const answer = answersByQuestion.get(question.id);
                return {
                  questionId: question.id,
                  order: question.order ?? idx,
                  prompt: question.displayPrompt || question.prompt || `Question ${idx + 1}`,
                  answer: answer?.answer ?? "",
                  awardedPoints: answer?.awardedPoints ?? null,
                };
              });

            return {
              roundId: round.id,
              title: round.title,
              order: round.order,
              questions,
            } satisfies BreakdownRound;
          })
        );

        if (!cancelled) {
          setRows(loaded);
          const nextDrafts: Record<string, string> = {};
          loaded.forEach((round) => {
            round.questions.forEach((question) => {
              const key = `${round.roundId}:${question.questionId}`;
              nextDrafts[key] =
                typeof question.awardedPoints === "number"
                  ? String(question.awardedPoints)
                  : "";
            });
          });
          setDraftPoints(nextDrafts);
        }
      } catch (loadError) {
        console.error("[score-breakdown] load failed", loadError);
        if (!cancelled) {
          setError("Unable to load score breakdown right now.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, roomSlug, roundQuestions, roundsMeta, teamId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const totalPoints = useMemo(() => {
    return rows.reduce((sum, round) => {
      const roundPoints = round.questions.reduce((acc, question) => {
        return acc + (typeof question.awardedPoints === "number" ? Math.max(0, question.awardedPoints) : 0);
      }, 0);
      return sum + roundPoints;
    }, 0);
  }, [rows]);

  if (!isOpen || !teamId) return null;

  async function savePoints(roundId: string, questionId: string, points: number) {
    if (!isHost || !teamId) return;
    const clampedPoints = Math.max(0, points);
    const key = `${roundId}:${questionId}`;
    setSavingKey(key);
    setRows((prev) =>
      prev.map((round) =>
        round.roundId !== roundId
          ? round
          : {
              ...round,
              questions: round.questions.map((question) =>
                question.questionId !== questionId
                  ? question
                  : { ...question, awardedPoints: clampedPoints }
              ),
            }
      )
    );

    try {
      const db = getClientFirestore();
      await setDoc(
        doc(
          db,
          "rooms",
          roomSlug,
          "rounds",
          roundId,
          "teamAnswers",
          teamId,
          "answers",
          questionId
        ),
        {
          awardedPoints: clampedPoints,
          gradedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await onPointsUpdated(teamId);
    } catch (saveError) {
      console.error("[score-breakdown] save failed", saveError);
      setError("Unable to update points right now.");
    } finally {
      setSavingKey((prev) => (prev === key ? null : prev));
    }
  }

  function parseDraftPoints(value: string) {
    if (!value.trim().length) return null;
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    return Math.max(0, parsed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Team score breakdown"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-400">
              Score breakdown
            </p>
            <h2 className="text-lg font-semibold text-zinc-100">
              {teamName ?? "Team"} · {totalPoints} pts
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-700"
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-auto px-5 py-4">
          {isLoading ? <p className="text-sm text-zinc-300">Loading...</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {!isLoading && !error ? (
            <div className="space-y-4">
              {rows.map((round) => {
                const roundPoints = round.questions.reduce((sum, question) => {
                  return (
                    sum +
                    (typeof question.awardedPoints === "number"
                      ? Math.max(0, question.awardedPoints)
                      : 0)
                  );
                }, 0);
                return (
                  <section
                    key={round.roundId}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/70"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                      <p className="text-sm font-semibold text-zinc-100">
                        {round.order + 1}. {round.title}
                      </p>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                        {roundPoints} pts
                      </p>
                    </div>
                    <div className="divide-y divide-zinc-800">
                      {round.questions.map((question) => {
                        const saveId = `${round.roundId}:${question.questionId}`;
                        return (
                          <div key={question.questionId} className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2">
                            <span className="w-8 text-xs font-semibold text-zinc-400">
                              #{question.order + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs text-zinc-400">{question.prompt}</p>
                              <p className="text-sm text-zinc-100">{question.answer || "—"}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const draftValue = draftPoints[saveId] ?? "";
                                const parsedDraft = parseDraftPoints(draftValue);
                                const persistedPoints =
                                  typeof question.awardedPoints === "number"
                                    ? Math.max(0, question.awardedPoints)
                                    : null;
                                const hasChanges =
                                  parsedDraft !== null && parsedDraft !== persistedPoints;
                                return (
                                  <>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                disabled={!isHost}
                                value={draftValue}
                                onChange={(event) => {
                                  if (!isHost) return;
                                  setDraftPoints((prev) => ({
                                    ...prev,
                                    [saveId]: event.target.value,
                                  }));
                                }}
                                className="h-8 w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              {isHost ? (
                                <button
                                  type="button"
                                  disabled={
                                    savingKey === saveId || parsedDraft === null || !hasChanges
                                  }
                                  onClick={() =>
                                    parsedDraft !== null
                                      ? void savePoints(round.roundId, question.questionId, parsedDraft)
                                      : undefined
                                  }
                                  className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Save
                                </button>
                              ) : null}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
