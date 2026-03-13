"use client";

import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import StageMedia from "@/lib/components/room/stage-media";

type GradingAnswer = {
  answer: string;
  hint?: string;
  awardedPoints?: number;
  order: number;
  questionId: string;
};

type GradingTeam = {
  answers: GradingAnswer[];
  teamId: string;
  teamName: string;
};

export function RoundStage({
  answerImageError,
  displayRoundMeta,
  finalizeScores,
  gradeAnswer,
  gradingMatrix,
  gradingTeamIndex,
  isAnswerImageLoading,
  isMediaLoading,
  isPresentingImageRound,
  mediaError,
  mediaKind,
  presenting,
  presentingAnswer,
  presentingAnswerImageUrl,
  presentingMedia,
  presentingMediaUrl,
  presentingQuestion,
  presentingRoundMeta,
  setGradingTeamIndex,
  mediaVolume,
}: {
  answerImageError: string | null;
  displayRoundMeta: RoundMeta | null;
  finalizeScores: () => void;
  gradeAnswer: (teamId: string, questionId: string, awardedPoints: number) => void;
  gradingMatrix: GradingTeam[];
  gradingTeamIndex: number;
  isAnswerImageLoading: boolean;
  isMediaLoading: boolean;
  isPresentingImageRound: boolean;
  mediaError: string | null;
  mediaKind: { isAudio: boolean; isImage: boolean; isVideo: boolean };
  presenting: {
    round?: string | null;
    question?: string | null;
    withAnswer?: boolean;
    answerPage?: number;
  } | null;
  presentingAnswer: string | null;
  presentingAnswerImageUrl: string | null;
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
  const answerStageIndex = Math.max(0, presenting?.answerPage ?? 0);
  const answerStageMedia = presentingQuestion?.answerStages?.[answerStageIndex]?.media ?? null;
  const answerMediaKind = {
    isAudio:
      typeof answerStageMedia?.contentType === "string"
        ? answerStageMedia.contentType.toLowerCase().startsWith("audio/")
        : false,
    isImage:
      typeof answerStageMedia?.contentType === "string"
        ? answerStageMedia.contentType.toLowerCase().startsWith("image/")
        : false,
    isVideo:
      typeof answerStageMedia?.contentType === "string"
        ? answerStageMedia.contentType.toLowerCase().startsWith("video/")
        : false,
  };

  return (
    <div className="relative flex-1 overflow-hidden bg-black">
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
                          <p className="text-sm text-white">{ans.answer || "—"}</p>
                          {ans.hint ? (
                            <p className="mt-1 text-xs text-emerald-100/80">
                              Hint: {ans.hint}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={typeof ans.awardedPoints === "number" ? ans.awardedPoints : ""}
                            onChange={(event) => {
                              if (event.target.value === "") return;
                              const next = Number.parseFloat(event.target.value);
                              if (Number.isNaN(next)) return;
                              void gradeAnswer(
                                gradingMatrix[gradingTeamIndex].teamId,
                                ans.questionId,
                                Math.max(0, next)
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
                                1
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-400 bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/40"
                            title="Set 1 point"
                          >
                            1
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void gradeAnswer(
                                gradingMatrix[gradingTeamIndex].teamId,
                                ans.questionId,
                                0
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-400 bg-red-400/20 text-red-100 hover:bg-red-400/40"
                            title="Set 0 points"
                          >
                            0
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
            className="presenting-scroll h-full w-full overflow-auto"
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
              {isPresentingImageRound && presenting?.withAnswer ? (
                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-6">
                    {presentingQuestion.prompt ? (
                      <h2 className="whitespace-pre-wrap text-3xl font-semibold leading-tight text-white">
                        {presentingQuestion.prompt}
                      </h2>
                    ) : null}

                    {presentingMedia ? (
                      <>
                        {isMediaLoading ? (
                          <p className="text-sm text-zinc-300">Loading media…</p>
                        ) : presentingMediaUrl ? (
                          <StageMedia
                            url={presentingMediaUrl}
                            kind={mediaKind}
                            fallbackName={presentingMedia.filename}
                            alt={presentingMedia.filename ?? "Question media"}
                            label={presentingQuestion.prompt ?? undefined}
                            mediaVolume={mediaVolume}
                            imageWrapperClassName="w-full"
                            imageClassName="max-h-[55vh] w-full rounded-2xl object-contain"
                            zoomLabel="Zoom question image"
                            mediaClassName="max-h-[55vh] w-full rounded-2xl bg-black object-contain"
                          />
                        ) : null}
                        {mediaError ? (
                          <p className="text-sm text-red-300">{mediaError}</p>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200/40 bg-emerald-900/20 p-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
                      Answer
                    </p>
                    {isAnswerImageLoading ? (
                      <p className="text-sm text-emerald-100">Loading answer…</p>
                    ) : presentingAnswerImageUrl ? (
                      <StageMedia
                        url={presentingAnswerImageUrl}
                        kind={answerMediaKind}
                        fallbackName={
                          answerStageMedia?.filename ??
                          answerStageMedia?.originalPath ??
                          null
                        }
                        alt="Correct answer"
                        label={presentingQuestion.prompt ?? undefined}
                        mediaVolume={mediaVolume}
                        imageWrapperClassName="w-full"
                        imageClassName="max-h-[65vh] h-auto w-full rounded-2xl object-contain"
                        zoomLabel="Zoom answer image"
                        mediaClassName="max-h-[65vh] w-full rounded-2xl bg-black object-contain"
                      />
                    ) : answerImageError ? (
                      <p className="text-sm text-red-300">{answerImageError}</p>
                    ) : (
                      <p className="text-sm text-emerald-100">
                        Answer not available.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {presentingMedia && mediaKind.isImage ? (
                    <>
                      {isMediaLoading ? (
                        <p className="text-sm text-zinc-300">Loading media…</p>
                      ) : presentingMediaUrl ? (
                        mediaKind.isImage && presentingQuestion.prompt ? (
                          <div className="w-full">
                            <StageMedia
                              url={presentingMediaUrl}
                              kind={mediaKind}
                              fallbackName={presentingMedia.filename}
                              alt={presentingMedia.filename ?? "Question media"}
                              label={presentingQuestion.prompt ?? undefined}
                              mediaVolume={mediaVolume}
                              imageWrapperClassName="mb-4 w-full md:float-right md:mb-3 md:ml-6 md:w-1/3 md:max-w-[33%]"
                              imageClassName="max-h-[55vh] w-full rounded-2xl object-contain"
                              zoomLabel="Zoom question image"
                            />
                            <h2 className="whitespace-pre-wrap text-3xl font-semibold leading-tight text-white">
                              {presentingQuestion.prompt}
                            </h2>
                            <div className="clear-both" />
                          </div>
                        ) : (
                          <div className="flex h-full min-h-0 w-full items-center justify-center">
                            <StageMedia
                              url={presentingMediaUrl}
                              kind={mediaKind}
                              fallbackName={presentingMedia.filename}
                              alt={presentingMedia.filename ?? "Question media"}
                              mediaVolume={mediaVolume}
                              imageWrapperClassName="h-full max-h-full max-w-full"
                              imageClassName="h-auto max-h-full w-auto max-w-full rounded-2xl object-contain"
                              zoomLabel="Zoom question image"
                            />
                          </div>
                        )
                      ) : null}
                      {mediaError ? (
                        <p className="text-sm text-red-300">{mediaError}</p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {presentingQuestion.prompt ? (
                        <h2 className="whitespace-pre-wrap text-3xl font-semibold leading-tight text-white">
                          {presentingQuestion.prompt}
                        </h2>
                      ) : null}
                      {presentingMedia ? (
                        <>
                          {isMediaLoading ? (
                            <p className="text-sm text-zinc-300">Loading media…</p>
                          ) : presentingMediaUrl ? (
                            <StageMedia
                              url={presentingMediaUrl}
                              kind={mediaKind}
                              fallbackName={presentingMedia.filename}
                              alt={presentingMedia.filename ?? "Question media"}
                              mediaVolume={mediaVolume}
                              mediaClassName={
                                isMediaOnlyStage
                                  ? "h-full w-full rounded-2xl bg-black object-contain"
                                  : "max-h-[55vh] w-full rounded-2xl bg-black object-contain"
                              }
                            />
                          ) : null}
                          {mediaError ? (
                            <p className="text-sm text-red-300">{mediaError}</p>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )}
                </>
              )}

              {!presentingQuestion.prompt && !presentingMedia ? (
                <p className="text-sm text-zinc-300">No content for this question.</p>
              ) : null}
            </div>
          </div>
          {presenting?.withAnswer &&
          !isPresentingImageRound &&
          (presentingAnswer || presentingAnswerImageUrl) ? (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                top: "10%",
                left: "10%",
                right: "10%",
                bottom: "10%",
              }}
            >
              <div className="flex h-full w-full items-center justify-center rounded-2xl border border-emerald-200/80 bg-emerald-700/98 px-8 py-6 text-center text-3xl font-semibold leading-tight text-white shadow-2xl">
                <div
                  className={`grid h-full w-full min-h-0 grid-rows-[minmax(0,1fr)] items-stretch gap-6 ${
                    presentingAnswer && presentingAnswerImageUrl
                      ? "md:grid-cols-2"
                      : "grid-cols-1"
                  }`}
                >
                  {presentingAnswer ? (
                    <span className="block self-center whitespace-pre-wrap break-words">{presentingAnswer}</span>
                  ) : null}
                  {presentingAnswerImageUrl ? (
                    <div className="flex h-full min-h-0 w-full self-stretch items-center justify-center">
                      <StageMedia
                        url={presentingAnswerImageUrl}
                        kind={answerMediaKind}
                        fallbackName={
                          answerStageMedia?.filename ??
                          answerStageMedia?.originalPath ??
                          null
                        }
                        alt="Answer media"
                        label={presentingAnswer ?? undefined}
                        mediaVolume={mediaVolume}
                        imageWrapperClassName="max-h-full max-w-full"
                        imageClassName="rounded-2xl"
                        fitImageToParent
                        zoomLabel="Zoom answer image"
                        mediaClassName="h-full max-h-full w-full rounded-2xl bg-black object-contain"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center px-8 text-center text-xl font-semibold text-white">
          Loading question…
        </div>
      )}

    </div>
  );
}
