"use client";

import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { allowsNegativePoints, getAwardedPoints, getAwardShortcut, getIncorrectAwardShortcut } from "@/lib/components/room/grading";
import { isQuestionMediaPlaybackActive } from "@/lib/media/presentation-playback";
import { AnswerOverlay } from "./answer-overlay";
import { QuestionStage } from "./question-stage";

type GradingAnswer = {
  answer: string;
  hint?: string;
  awardedPoints?: number;
  wagered?: boolean;
  order: number;
  step?: number | null;
  questionId: string;
};

type GradingTeam = {
  answers: GradingAnswer[];
  teamId: string;
  teamName: string;
};

export function RoundStage({
  answerMediaError,
  displayRoundMeta,
  finalizeScores,
  gradeAnswer,
  gradingMatrix,
  gradingTeamIndex,
  isAnswerMediaLoading,
  isMediaLoading,
  mediaError,
  answerMediaKind,
  mediaKind,
  presenting,
  presentingAnswer,
  presentingAnswerMedia,
  presentingAnswerMediaUrl,
  presentingMedia,
  presentingMediaUrl,
  presentingQuestion,
  presentingRoundMeta,
  setGradingTeamIndex,
  mediaVolume,
}: {
  answerMediaError: string | null;
  displayRoundMeta: RoundMeta | null;
  finalizeScores: () => void;
  gradeAnswer: (teamId: string, questionId: string, awardedPoints: number) => void;
  gradingMatrix: GradingTeam[];
  gradingTeamIndex: number;
  isAnswerMediaLoading: boolean;
  isMediaLoading: boolean;
  mediaError: string | null;
  answerMediaKind: { isAudio: boolean; isImage: boolean; isVideo: boolean };
  mediaKind: { isAudio: boolean; isImage: boolean; isVideo: boolean };
  presenting: {
    round?: string | null;
    question?: string | null;
    withAnswer?: boolean;
    answerPage?: number;
  } | null;
  presentingAnswer: string | null;
  presentingAnswerMedia:
    | {
        filename?: string | null;
        originalPath?: string | null;
      }
    | null;
  presentingAnswerMediaUrl: string | null;
  presentingMedia:
    | {
        filename?: string | null;
      }
    | null;
  presentingMediaUrl: string | null;
  presentingQuestion: RoundQuestion | null;
  presentingRoundMeta: RoundMeta | null;
  setGradingTeamIndex: React.Dispatch<React.SetStateAction<number>>;
  mediaVolume: number;
}) {
  const isMediaOnlyStage = Boolean(
    presentingQuestion &&
      presentingMedia &&
      !presentingQuestion.prompt
  );
  const questionMediaPlaybackActive = isQuestionMediaPlaybackActive({
    withAnswer: presenting?.withAnswer === true, hasQuestionMedia: Boolean(presentingMedia), hasAnswerMedia: Boolean(presentingAnswerMedia),
  });

  return (
    <div className="presentation-scrollbars relative flex-1 overflow-hidden bg-black">
      {!presenting?.round ? (
        displayRoundMeta ? (
          <div className="flex h-full w-full items-center justify-center px-8 text-center text-2xl font-semibold text-white">
            {displayRoundMeta.title}
          </div>
        ) : (
          <div className="h-full w-full bg-black" />
        )
      ) : presenting?.round && !presenting?.question ? (
        presentingRoundMeta?.state === "closed" &&
        gradingMatrix.length &&
        gradingTeamIndex >= 0 &&
        gradingTeamIndex < gradingMatrix.length ? (
          <div className="flex h-full w-full flex-col gap-4 overflow-auto px-6 py-6 text-white">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200">
                Grade answers · {presentingRoundMeta.title} ·{" "}
                {gradingMatrix[gradingTeamIndex]?.teamName ?? ""}
              </p>
              <button
                type="button"
                onClick={finalizeScores}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1"
              >
                Finish grading
              </button>
            </div>
            <div className="space-y-3">
              {gradingMatrix[gradingTeamIndex] ? (
                <div
                  key={gradingMatrix[gradingTeamIndex].teamId}
                  className="rounded-2xl border border-emerald-200/40 bg-emerald-900/20 p-3"
                >
                  <div className="space-y-2">
                    {gradingMatrix[gradingTeamIndex].answers.map((ans) => (
                      <div
                        key={ans.questionId}
                        className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
                          typeof ans.awardedPoints !== "number"
                            ? "border-white/20 bg-transparent"
                            : ans.awardedPoints > 0
                              ? "border-emerald-300/40 bg-emerald-500/20"
                              : "border-red-300/40 bg-red-500/20"
                        }`}
                      >
                        <div className="w-8 text-xs font-semibold text-emerald-100">
                          #{ans.order + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {typeof ans.step === "number" ? (
                              <span
                                className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-emerald-300/20 px-1 text-[11px] font-semibold text-emerald-100"
                                title="Step"
                              >
                                {ans.step + 1}
                              </span>
                            ) : null}
                            {ans.wagered ? <span className="text-xs font-semibold text-amber-300">x2</span> : null}
                            <p className="text-sm text-white">{ans.answer || "—"}</p>
                          </div>
                          {ans.hint ? (
                            <p className="mt-1 text-xs text-emerald-100/80">
                              Hint: {ans.hint}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={allowsNegativePoints(presentingRoundMeta) ? undefined : 0}
                            step="any"
                            value={typeof ans.awardedPoints === "number" ? ans.awardedPoints : ""}
                            onChange={(event) => {
                              if (event.target.value === "") return;
                              const next = Number.parseFloat(event.target.value);
                              if (!Number.isFinite(next)) return;
                              void gradeAnswer(
                                gradingMatrix[gradingTeamIndex].teamId,
                                ans.questionId,
                                getAwardedPoints(next, presentingRoundMeta)
                              );
                            }}
                            className="h-8 w-20 rounded-md border border-zinc-300 bg-white/95 px-2 text-xs font-semibold text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
                            title="Awarded points"
                            placeholder="—"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void gradeAnswer(
                                gradingMatrix[gradingTeamIndex].teamId,
                                ans.questionId,
                                getAwardShortcut(ans, presentingRoundMeta)
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-400 bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/40"
                            title="Set points"
                          >
                            {getAwardShortcut(ans, presentingRoundMeta)}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void gradeAnswer(
                                gradingMatrix[gradingTeamIndex].teamId,
                                ans.questionId,
                                getIncorrectAwardShortcut(ans, presentingRoundMeta)
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400 bg-red-400/20 text-red-100 hover:bg-red-400/40"
                            title={`Set ${getIncorrectAwardShortcut(ans, presentingRoundMeta)} points`}
                          >
                            {getIncorrectAwardShortcut(ans, presentingRoundMeta)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setGradingTeamIndex((prev) => Math.max(0, prev - 1))
                        }
                        disabled={gradingTeamIndex <= 0}
                        className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-50"
                      >
                        Prev team
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setGradingTeamIndex((prev) =>
                            Math.min(gradingMatrix.length - 1, prev + 1)
                          )
                        }
                        disabled={gradingTeamIndex >= gradingMatrix.length - 1}
                        className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-50"
                      >
                        Next team
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-8 text-center text-2xl font-semibold text-white">
            {presentingRoundMeta?.title ?? "Round in progress"}
          </div>
        )
      ) : presentingQuestion ? (
        <div className="relative h-full w-full text-white">
          <div
            className="h-full w-full overflow-auto"
          >
            <div
              className={
                isMediaOnlyStage
                  ? "flex h-full items-center justify-center px-4 py-4"
                  : presentingMedia
                    ? "flex max-h-full px-4 py-4"
                    : "flex flex-col gap-6 px-8 py-10"
              }
            >
              <QuestionStage text={presentingQuestion.prompt} hasMedia={Boolean(presentingMedia)} mediaName={presentingMedia?.filename}
                mediaUrl={presentingMediaUrl} mediaKind={mediaKind} loading={isMediaLoading} error={mediaError}
                mediaVolume={mediaVolume} playbackActive={questionMediaPlaybackActive} fillMedia={isMediaOnlyStage} />

              {!presentingQuestion.prompt && !presentingMedia ? (
                <p className="text-sm text-zinc-300">No content for this question.</p>
              ) : null}
            </div>
          </div>
          {presenting?.withAnswer ? <AnswerOverlay text={presentingAnswer} mediaUrl={presentingAnswerMediaUrl}
            mediaName={presentingAnswerMedia?.filename ?? presentingAnswerMedia?.originalPath} mediaKind={answerMediaKind}
            loading={isAnswerMediaLoading} error={answerMediaError} mediaVolume={mediaVolume} /> : null}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center px-8 text-center text-xl font-semibold text-white">
          Loading question…
        </div>
      )}

    </div>
  );
}
