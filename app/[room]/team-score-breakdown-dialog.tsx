"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, getDoc, runTransaction, setDoc, doc, serverTimestamp } from "firebase/firestore";

import { getClientFirestore } from "@/lib/firebase/client";
import { allowsNegativePoints, getAwardedPoints } from "@/lib/components/room/grading";
import { SortingQuestionContent } from "@/lib/components/sorting-round";
import { recordedAnswer } from "@/lib/answers";
import { parseBreakdownAttempts, parseBreakdownSortingOrder, parseDraftPoints, type BreakdownAttempt, type SortingBreakdown } from "./team-score-breakdown";
import { getSortingQuestions, type RoundMeta, type RoundQuestion } from "@/lib/hooks/use-room-rounds";

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
  wagered?: boolean;
  step: number | null;
  attempts: BreakdownAttempt[];
  perceptionScore: number | null;
};

type BreakdownRound = {
  roundId: string;
  criterion?: string;
  sorting?: SortingBreakdown;
  type: RoundMeta["type"];
  allowWager?: boolean;
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
            if (round.type === "sorting") {
              const submission = await getDoc(doc(db, "rooms", roomSlug, "rounds", round.id, "teamAnswers", activeTeamId));
              const scored = round.gradingRequired === false;
              const correct = scored ? await getDoc(doc(db, "rooms", roomSlug, "rounds", round.id, "answers", "order")) : null;
              const sorting = parseBreakdownSortingOrder(submission.data(), correct?.data()?.correctOrder, getSortingQuestions(roundQuestions[round.id] ?? []), scored);
              return { roundId: round.id, type: round.type, title: round.title, order: round.order, criterion: round.criterion, sorting,
                questions: sorting.order.map((id, index) => ({ questionId: id, order: index, prompt: "", answer: "", awardedPoints: sorting.pointsByQuestion[id] ?? null,
                  step: null, attempts: [], perceptionScore: null })) } satisfies BreakdownRound;
            }
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
              { answer: string; wagered?: boolean; awardedPoints: number | null; step: number | null; attempts: BreakdownAttempt[]; perceptionScore: number | null }
            >();
            answersSnap.forEach((snap) => {
              const data = snap.data();
              answersByQuestion.set(snap.id, {
                ...recordedAnswer(data, round.type),
                wagered: data.wagered === true,
                awardedPoints:
                  typeof data.awardedPoints === "number" ? getAwardedPoints(data.awardedPoints, round) : null,
                attempts: parseBreakdownAttempts(data.attempts),
                perceptionScore: typeof data.perceptionScore === "number" ? data.perceptionScore : null,
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
                  wagered: answer?.wagered,
                  awardedPoints: answer?.awardedPoints ?? null,
                  step: answer?.step ?? null,
                  attempts: answer?.attempts ?? [],
                  perceptionScore: answer?.perceptionScore ?? null,
                };
              });

            return {
              roundId: round.id,
              type: round.type,
              allowWager: round.allowWager,
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
        return acc + (question.awardedPoints ?? 0);
      }, 0);
      return sum + roundPoints;
    }, 0);
  }, [rows]);

  if (!isOpen || !teamId) return null;

  async function savePoints(roundId: string, questionId: string, points: number) {
    if (!isHost || !teamId) return;
    const round = rows.find((entry) => entry.roundId === roundId);
    if (!round) return;
    const normalizedPoints = getAwardedPoints(points, round);
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
                  : { ...question, awardedPoints: normalizedPoints }
              ),
            }
      )
    );

    try {
      const db = getClientFirestore();
      if (round.sorting) {
        const ref = doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId);
        await runTransaction(db, async (tx) => {
          const saved = (await tx.get(ref)).data();
          if (!saved?.graded || !saved.pointsByQuestion || !Object.hasOwn(saved.pointsByQuestion, questionId)) throw new Error("Sorting results are not scored.");
          const pointsByQuestion = { ...saved.pointsByQuestion, [questionId]: normalizedPoints } as Record<string, number>;
          const awardedPoints = Object.values(pointsByQuestion).reduce((sum, value) => sum + value, 0);
          tx.set(ref, { pointsByQuestion, awardedPoints, gradedAt: serverTimestamp() }, { merge: true });
        });
      } else {
        await setDoc(doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers", questionId),
          { awardedPoints: normalizedPoints, gradedAt: serverTimestamp() }, { merge: true });
      }

      await onPointsUpdated(teamId);
    } catch (saveError) {
      console.error("[score-breakdown] save failed", saveError);
      setError("Unable to update points right now.");
    } finally {
      setSavingKey((prev) => (prev === key ? null : prev));
    }
  }

  function pointsEditor(round: BreakdownRound, question: BreakdownQuestion) {
    const saveId = `${round.roundId}:${question.questionId}`;
    const draftValue = draftPoints[saveId] ?? "";
    const parsedDraft = parseDraftPoints(draftValue, round);
    const hasChanges = parsedDraft !== null && parsedDraft !== question.awardedPoints;
    return <>
      <input type="number" aria-label={`Points for position ${question.order + 1}`} min={allowsNegativePoints(round) ? undefined : 0} step="any"
        disabled={!isHost || (round.sorting !== undefined && round.sorting.correctOrder === null)} value={draftValue}
        onChange={(event) => { if (isHost) setDraftPoints((prev) => ({ ...prev, [saveId]: event.target.value })); }}
        className="h-8 w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60" />
      {isHost ? <button type="button" disabled={savingKey === saveId || parsedDraft === null || !hasChanges || (round.sorting !== undefined && round.sorting.correctOrder === null)}
        onClick={() => { if (parsedDraft !== null) void savePoints(round.roundId, question.questionId, parsedDraft); }}
        className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50">Save</button> : null}
    </>;
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
                  return sum + (question.awardedPoints ?? 0);
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
                    {round.sorting ? <div className="p-4" aria-label="Sorting comparison">
                      <p className="mb-3 text-sm text-zinc-300">{round.criterion}</p>
                      {round.sorting.correctOrder ? <div className="mb-2 hidden grid-cols-[2rem_1fr_1fr_7rem] gap-3 text-xs text-zinc-400 sm:grid"><span>#</span><span>Correct order</span><span>Your submitted order</span><span>Points</span></div> : <p className="mb-3 text-sm text-zinc-400">Awaiting scoring</p>}
                      <ol className="divide-y divide-zinc-800">{round.questions.map((question, index) => {
                        const sorting = round.sorting!;
                        const submitted = sorting.questions.find((entry) => entry.id === sorting.order[index])!;
                        const correct = sorting.correctOrder ? sorting.questions.find((entry) => entry.id === sorting.correctOrder![index])! : null;
                        return <li key={question.questionId} className="grid gap-3 py-3 sm:grid-cols-[2rem_1fr_1fr_7rem]" aria-label={`Position ${index + 1}`}>
                          <span className="text-xs text-zinc-400">#{index + 1}</span>
                          <div className="min-w-0" aria-label="Correct item"><p className="mb-1 text-xs text-zinc-400 sm:hidden">Correct order</p>{correct ? <SortingQuestionContent item={correct} index={index} /> : "—"}</div>
                          <div className="min-w-0" aria-label="Submitted item"><p className="mb-1 text-xs text-zinc-400 sm:hidden">Your submitted order</p><SortingQuestionContent item={submitted} index={index} /></div>
                          <div className="flex items-center gap-2" aria-label="Points"><span className="text-xs text-zinc-400 sm:hidden">Points</span>{pointsEditor(round, question)}</div>
                        </li>;
                      })}</ol>
                    </div> : <div className="divide-y divide-zinc-800">
                      {round.questions.map((question) => {
                        return (
                          <div key={question.questionId} className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2">
                            <span className="w-8 text-xs font-semibold text-zinc-400">
                              #{question.order + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs text-zinc-400">{question.prompt}</p>
                              <div className="flex items-center gap-2">
                                {typeof question.step === "number" ? (
                                  <span
                                    className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-emerald-300/20 px-1 text-[11px] font-semibold text-emerald-100"
                                    title="Step"
                                  >
                                    {question.step + 1}
                                  </span>
                                ) : null}
                                <p className="text-sm text-zinc-100">{question.answer || "—"}</p>
                                {question.wagered ? <span className="text-xs font-semibold text-amber-300">x2</span> : null}
                                {round.type === "color" && question.perceptionScore !== null ? <span className="text-xs text-zinc-300">{question.perceptionScore.toFixed(2)} / 10</span> : null}
                              </div>
                              {question.attempts.length > 1 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {question.attempts.map((attempt) => (
                                    <span
                                      key={`${question.questionId}:${attempt.step}`}
                                      className="inline-flex max-w-full items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200"
                                    >
                                      <span className="text-emerald-200" title="Step">
                                        {attempt.step + 1}
                                      </span>
                                      <span className="truncate">{attempt.answer}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {pointsEditor(round, question)}
                            </div>
                          </div>
                        );
                      })}
                    </div>}
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
