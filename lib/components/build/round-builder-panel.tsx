"use client";

import { useEffect, useMemo, useState } from "react";
import { RoundStage } from "@/lib/components/room/round-stage";
import type { MediaTreeFile } from "@/lib/components/build/media-tree-shared";
import MediaSelector from "@/lib/components/build/media-selector";
import type {
  RoundMeta,
  RoundQuestion,
  RoundQuestionMedia,
  RoundQuestionStage,
} from "@/lib/hooks/use-room-rounds";

type RoundType = "text" | "image";

type Stage = {
  id: string;
  collapsed: boolean;
  text: string;
  mediaPath: string | null;
};

type TextQuestion = {
  id: string;
  collapsed: boolean;
  promptStages: Stage[];
  answerHint: string;
  answerStages: Stage[];
};

type ImageItem = {
  id: string;
  collapsed: boolean;
  imagePath: string | null;
  answerStage: Stage;
};

export type BuildRound = {
  id: string;
  collapsed: boolean;
  name: string;
  type: RoundType;
  textQuestions: TextQuestion[];
  imageItems: ImageItem[];
};

type PreviewTarget = {
  roundId: string;
  questionIndex: number;
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createStage(): Stage {
  return {
    id: makeId(),
    collapsed: false,
    text: "",
    mediaPath: null,
  };
}

function createTextQuestion(): TextQuestion {
  return {
    id: makeId(),
    collapsed: false,
    promptStages: [createStage()],
    answerHint: "",
    answerStages: [createStage()],
  };
}

function createImageItem(): ImageItem {
  return {
    id: makeId(),
    collapsed: false,
    imagePath: null,
    answerStage: createStage(),
  };
}

function createRound(): BuildRound {
  return {
    id: makeId(),
    collapsed: false,
    name: "New round",
    type: "text",
    textQuestions: [createTextQuestion()],
    imageItems: [],
  };
}

function EyeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path
        d="M2 12c2-3 5.6-6 10-6s8 3 10 6c-2 3-5.6 6-10 6s-8-3-10-6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeOffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path
        d="M4.5 4.5C3 6 2 8 2 12c2 3 5.6 6 10 6 2.1 0 4-.5 5.6-1.4M9.88 9.88a3 3 0 104.24 4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function inferMediaKind(path: string | null): { isAudio: boolean; isImage: boolean; isVideo: boolean } {
  if (!path) {
    return { isAudio: false, isImage: false, isVideo: false };
  }
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return {
    isImage: ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext),
    isAudio: ["mp3", "wav", "ogg", "m4a"].includes(ext),
    isVideo: ["mp4", "mov", "webm"].includes(ext),
  };
}

function StageEditor({
  stage,
  mediaFiles,
  onChange,
  onRemove,
  title,
}: {
  stage: Stage;
  mediaFiles: MediaTreeFile[];
  onChange: (next: Stage) => void;
  onRemove?: () => void;
  title: string;
}) {
  const inlineLabelClass =
    "w-12 px-1 text-sm font-semibold text-zinc-700 dark:text-white";

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...stage, collapsed: !stage.collapsed })}
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            title={stage.collapsed ? "Expand" : "Collapse"}
          >
            {stage.collapsed ? "▸" : "▾"}
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</p>
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
            aria-label="Remove stage"
            title="Remove stage"
          >
            ×
          </button>
        ) : null}
      </div>
      {!stage.collapsed ? (
        <>
          <div className="flex items-start gap-2">
            <p className={inlineLabelClass}>
              Text
            </p>
            <textarea
              value={stage.text}
              onChange={(event) => onChange({ ...stage, text: event.target.value })}
              rows={3}
              placeholder="Write your text..."
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <p className={inlineLabelClass}>
              Media
            </p>
            <div className="min-w-0 flex-1">
              <MediaSelector
                value={stage.mediaPath}
                mediaFiles={mediaFiles}
                onChange={(mediaPath) => onChange({ ...stage, mediaPath })}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function RoundBuilderPanel({
  mediaFiles,
  initialRounds,
  onRoundsChange,
}: {
  mediaFiles: MediaTreeFile[];
  initialRounds?: BuildRound[];
  onRoundsChange?: (rounds: BuildRound[]) => void;
}) {
  const [rounds, setRounds] = useState<BuildRound[]>(() => initialRounds ?? []);
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [editingRoundName, setEditingRoundName] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [isPreviewQuestionVisible, setIsPreviewQuestionVisible] = useState(true);
  const [previewQuestionIndex, setPreviewQuestionIndex] = useState(0);
  const [previewPromptPage, setPreviewPromptPage] = useState(0);
  const [previewWithAnswer, setPreviewWithAnswer] = useState(false);
  const [previewAnswerPage, setPreviewAnswerPage] = useState(0);
  const [previewGradingTeamIndex, setPreviewGradingTeamIndex] = useState(0);

  const roundCountLabel = useMemo(() => `${rounds.length} round${rounds.length === 1 ? "" : "s"}`, [rounds.length]);

  useEffect(() => {
    onRoundsChange?.(rounds);
  }, [onRoundsChange, rounds]);

  const previewMediaUrls = useMemo(() => {
    const next: Record<string, string> = {};
    mediaFiles.forEach((mediaFile) => {
      next[mediaFile.path] = URL.createObjectURL(mediaFile.file);
    });
    return next;
  }, [mediaFiles]);

  useEffect(() => {
    return () => {
      Object.values(previewMediaUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewMediaUrls]);

  function updateRound(roundId: string, updater: (round: BuildRound) => BuildRound) {
    setRounds((prev) => prev.map((round) => (round.id === roundId ? updater(round) : round)));
  }

  function addRound() {
    const next = createRound();
    setRounds((prev) => [...prev, next]);
    setEditingRoundId(next.id);
    setEditingRoundName(next.name);
  }

  function removeRound(roundId: string) {
    setRounds((prev) => prev.filter((round) => round.id !== roundId));
  }

  function resetRoundByType(round: BuildRound, type: RoundType): BuildRound {
    if (type === "text") {
      return {
        ...round,
        type,
        textQuestions: [createTextQuestion()],
        imageItems: [],
      };
    }
    return {
      ...round,
      type,
      textQuestions: [],
      imageItems: [createImageItem()],
    };
  }

  function beginRoundRename(round: BuildRound) {
    setEditingRoundId(round.id);
    setEditingRoundName(round.name);
  }

  function commitRoundRename() {
    if (!editingRoundId) return;
    const nextName = editingRoundName.trim() || "New round";
    updateRound(editingRoundId, (prev) => ({ ...prev, name: nextName }));
    setEditingRoundId(null);
    setEditingRoundName("");
  }

  function cancelRoundRename() {
    setEditingRoundId(null);
    setEditingRoundName("");
  }

  function openPreview(roundId: string, questionIndex: number) {
    setPreviewTarget({ roundId, questionIndex });
    setIsPreviewQuestionVisible(true);
    setPreviewQuestionIndex(questionIndex);
    setPreviewPromptPage(0);
    setPreviewWithAnswer(false);
    setPreviewAnswerPage(0);
  }

  function closePreview() {
    setPreviewTarget(null);
    setPreviewWithAnswer(false);
    setPreviewAnswerPage(0);
    setPreviewPromptPage(0);
  }

  const previewRound = useMemo(
    () => (previewTarget ? rounds.find((round) => round.id === previewTarget.roundId) ?? null : null),
    [previewTarget, rounds]
  );

  const previewQuestionsCount = useMemo(() => {
    if (!previewRound) return 0;
    return previewRound.type === "text"
      ? previewRound.textQuestions.length
      : previewRound.imageItems.length;
  }, [previewRound]);

  const boundedPreviewQuestionIndex = useMemo(() => {
    if (!previewQuestionsCount) return 0;
    return Math.min(Math.max(previewQuestionIndex, 0), previewQuestionsCount - 1);
  }, [previewQuestionIndex, previewQuestionsCount]);

  const previewCurrentTextQuestion = useMemo(() => {
    if (!previewRound || previewRound.type !== "text") return null;
    return previewRound.textQuestions[boundedPreviewQuestionIndex] ?? null;
  }, [boundedPreviewQuestionIndex, previewRound]);

  const previewCurrentImageItem = useMemo(() => {
    if (!previewRound || previewRound.type !== "image") return null;
    return previewRound.imageItems[boundedPreviewQuestionIndex] ?? null;
  }, [boundedPreviewQuestionIndex, previewRound]);

  const previewQuestionStageCount = useMemo(() => {
    if (!previewRound) return 0;
    if (previewRound.type === "text") {
      return previewCurrentTextQuestion?.promptStages.length ?? 0;
    }
    const promptStage = previewCurrentImageItem?.answerStage;
    if (!promptStage) return 0;
    return promptStage.text.trim() || promptStage.mediaPath ? 1 : 0;
  }, [previewCurrentImageItem, previewCurrentTextQuestion, previewRound]);

  const boundedPreviewPromptPage = useMemo(() => {
    if (!previewQuestionStageCount) return 0;
    return Math.min(Math.max(previewPromptPage, 0), previewQuestionStageCount - 1);
  }, [previewPromptPage, previewQuestionStageCount]);

  const previewAnswerStageCount = useMemo(() => {
    if (!previewRound || !previewWithAnswer) return 0;
    if (previewRound.type === "text") {
      return previewCurrentTextQuestion?.answerStages.length ?? 0;
    }
    return previewCurrentImageItem?.imagePath ? 1 : 0;
  }, [previewCurrentImageItem, previewCurrentTextQuestion, previewRound, previewWithAnswer]);

  const boundedPreviewAnswerPage = useMemo(() => {
    if (!previewAnswerStageCount) return 0;
    return Math.min(Math.max(previewAnswerPage, 0), previewAnswerStageCount - 1);
  }, [previewAnswerPage, previewAnswerStageCount]);

  const stagedPreviewQuestion = useMemo<RoundQuestion | null>(() => {
    if (!previewRound || !isPreviewQuestionVisible) return null;

    if (previewRound.type === "text") {
      if (!previewCurrentTextQuestion) return null;
      const currentStage = previewCurrentTextQuestion.promptStages[boundedPreviewPromptPage];
      const stageText = currentStage?.text?.trim() ? currentStage.text.trim() : null;
      const stageMediaPath = currentStage?.mediaPath ?? null;
      const stageMedia: RoundQuestionMedia | null = stageMediaPath
        ? {
            storagePath: stageMediaPath,
            filename: stageMediaPath.split("/").pop() ?? stageMediaPath,
            originalPath: stageMediaPath,
          }
        : null;
      const promptStages: RoundQuestionStage[] = previewCurrentTextQuestion.promptStages.map((stage) => ({
        text: stage.text.trim() ? stage.text.trim() : null,
        media: stage.mediaPath
          ? {
              storagePath: stage.mediaPath,
              filename: stage.mediaPath.split("/").pop() ?? stage.mediaPath,
              originalPath: stage.mediaPath,
            }
          : null,
      }));
      const answerStages: RoundQuestionStage[] = previewCurrentTextQuestion.answerStages.map((stage) => ({
        text: stage.text.trim() ? stage.text.trim() : null,
        media: stage.mediaPath
          ? {
              storagePath: stage.mediaPath,
              filename: stage.mediaPath.split("/").pop() ?? stage.mediaPath,
              originalPath: stage.mediaPath,
            }
          : null,
      }));

      return {
        id: previewCurrentTextQuestion.id,
        order: boundedPreviewQuestionIndex,
        displayPrompt: stageText ?? `Question ${boundedPreviewQuestionIndex + 1}`,
        prompt: stageText,
        media: stageMedia,
        promptStages,
        answerStages,
        answerHint: previewCurrentTextQuestion.answerHint,
        correctAnswer: null,
      };
    }

    if (!previewCurrentImageItem) return null;
    const promptStage = previewCurrentImageItem.answerStage;
    const promptText = promptStage?.text?.trim() ? promptStage.text.trim() : null;
    const promptMediaPath = promptStage?.mediaPath ?? null;
    const promptMedia: RoundQuestionMedia | null = promptMediaPath
      ? {
          storagePath: promptMediaPath,
          filename: promptMediaPath.split("/").pop() ?? promptMediaPath,
          originalPath: promptMediaPath,
        }
      : null;

    return {
      id: previewCurrentImageItem.id,
      order: boundedPreviewQuestionIndex,
      displayPrompt: promptText ?? `Image ${boundedPreviewQuestionIndex + 1}`,
      prompt: promptText,
      media: promptMedia,
      promptStages: promptText || promptMedia ? [{ text: promptText, media: promptMedia }] : [],
      answerStages: undefined,
      answerHint: null,
      correctAnswer: null,
    };
  }, [
    boundedPreviewPromptPage,
    isPreviewQuestionVisible,
    boundedPreviewQuestionIndex,
    previewCurrentImageItem,
    previewCurrentTextQuestion,
    previewRound,
  ]);

  const previewPresentingMedia = useMemo(
    () => stagedPreviewQuestion?.media ?? null,
    [stagedPreviewQuestion]
  );
  const previewPresentingMediaUrl = useMemo(
    () => (previewPresentingMedia ? previewMediaUrls[previewPresentingMedia.storagePath] ?? null : null),
    [previewMediaUrls, previewPresentingMedia]
  );

  const previewMediaKind = useMemo(
    () => inferMediaKind(previewPresentingMedia?.storagePath ?? null),
    [previewPresentingMedia?.storagePath]
  );

  const previewPresentingAnswer = useMemo(() => {
    if (!previewWithAnswer || !previewRound) return null;
    if (previewRound.type === "image") return null;
    if (!previewCurrentTextQuestion) return null;
    const stage = previewCurrentTextQuestion.answerStages[boundedPreviewAnswerPage];
    const text = stage?.text?.trim();
    return text ? text : null;
  }, [boundedPreviewAnswerPage, previewCurrentTextQuestion, previewRound, previewWithAnswer]);

  const previewPresentingAnswerMedia = useMemo<RoundQuestionMedia | null>(() => {
    if (!previewWithAnswer || !previewRound) return null;
    if (previewRound.type === "image") {
      const imagePath = previewCurrentImageItem?.imagePath ?? null;
      if (!imagePath) return null;
      return {
        storagePath: imagePath,
        filename: imagePath.split("/").pop() ?? imagePath,
        originalPath: imagePath,
      };
    }
    if (!previewCurrentTextQuestion) return null;
    const stage = previewCurrentTextQuestion.answerStages[boundedPreviewAnswerPage];
    const mediaPath = stage?.mediaPath ?? null;
    if (!mediaPath) return null;
    return {
      storagePath: mediaPath,
      filename: mediaPath.split("/").pop() ?? mediaPath,
      originalPath: mediaPath,
    };
  }, [
    boundedPreviewAnswerPage,
    previewCurrentImageItem,
    previewCurrentTextQuestion,
    previewRound,
    previewWithAnswer,
  ]);

  const previewPresentingAnswerMediaUrl = useMemo(
    () =>
      previewPresentingAnswerMedia
        ? previewMediaUrls[previewPresentingAnswerMedia.storagePath] ?? null
        : null,
    [previewMediaUrls, previewPresentingAnswerMedia]
  );

  const previewAnswerMediaKind = useMemo(
    () => inferMediaKind(previewPresentingAnswerMedia?.storagePath ?? null),
    [previewPresentingAnswerMedia?.storagePath]
  );

  const previewRoundMeta = useMemo<RoundMeta | null>(() => {
    if (!previewRound) return null;
    const roundOrder = rounds.findIndex((round) => round.id === previewRound.id);
    return {
      id: previewRound.id,
      title: previewRound.name,
      order: roundOrder >= 0 ? roundOrder : 0,
      type: previewRound.type,
      state: "closed",
      gradingRequired: false,
    };
  }, [previewRound, rounds]);

  const previewPresentingPayload = useMemo(
    () =>
      previewRoundMeta
        ? {
            round: previewRoundMeta.id,
            question: isPreviewQuestionVisible && stagedPreviewQuestion ? stagedPreviewQuestion.id : null,
            withAnswer: previewWithAnswer,
          }
        : null,
    [isPreviewQuestionVisible, previewRoundMeta, previewWithAnswer, stagedPreviewQuestion]
  );
  const previewHasQuestion = Boolean(isPreviewQuestionVisible && stagedPreviewQuestion);

  return (
    <>
      <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
            Round builder
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{roundCountLabel}</p>
        </div>
        <button
          type="button"
          onClick={addRound}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
          aria-label="Add round"
          title="Add round"
        >
          Add round
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {!rounds.length ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No rounds yet.
          </div>
        ) : null}

        {rounds.map((round) => (
          <article
            key={round.id}
            className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateRound(round.id, (prev) => ({ ...prev, collapsed: !prev.collapsed }))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                {round.collapsed ? "▸" : "▾"}
              </button>
              {editingRoundId === round.id ? (
                <input
                  autoFocus
                  value={editingRoundName}
                  onChange={(event) => setEditingRoundName(event.target.value)}
                  onBlur={commitRoundRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRoundRename();
                    if (event.key === "Escape") cancelRoundRename();
                  }}
                  className="min-w-0 flex-1 rounded bg-white px-1.5 py-0.5 text-sm text-zinc-900 outline-none ring-1 ring-emerald-400 dark:bg-zinc-900 dark:text-zinc-100"
                />
              ) : (
                <button
                  type="button"
                  onDoubleClick={() => beginRoundRename(round)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-zinc-800 dark:text-zinc-100"
                  title="Double-click to rename"
                >
                  {round.name}
                </button>
              )}
              <button
                type="button"
                onClick={() => beginRoundRename(round)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                title="Rename round"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => removeRound(round.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
                aria-label="Remove round"
                title="Remove round"
              >
                ×
              </button>
            </div>

            {!round.collapsed ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Type</p>
                  <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
                    {(["text", "image"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          updateRound(round.id, (prev) =>
                            prev.type === type ? prev : resetRoundByType(prev, type)
                          )
                        }
                        className={[
                          "rounded-md px-3 py-1.5 text-sm font-semibold transition",
                          round.type === type
                            ? "bg-emerald-500 text-white"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {type === "text" ? "Text" : "Image"}
                      </button>
                    ))}
                  </div>
                </div>

                {round.type === "text" ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Questions</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateRound(round.id, (prev) => ({
                            ...prev,
                            textQuestions: [...prev.textQuestions, createTextQuestion()],
                          }))
                        }
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                        aria-label="Add question"
                        title="Add question"
                      >
                        +
                      </button>
                    </div>

                    {round.textQuestions.map((question, questionIndex) => (
                      <div
                        key={question.id}
                        className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                textQuestions: prev.textQuestions.map((item) =>
                                  item.id === question.id
                                    ? { ...item, collapsed: !item.collapsed }
                                    : item
                                ),
                              }))
                            }
                            className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                          >
                            {question.collapsed ? "▸" : "▾"}
                          </button>
                          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                            Question {questionIndex + 1}
                          </p>
                          <button
                            type="button"
                            onClick={() => openPreview(round.id, questionIndex)}
                            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                            aria-label="Preview question"
                            title="Preview"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                textQuestions: prev.textQuestions.filter((item) => item.id !== question.id),
                              }))
                            }
                            className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
                            aria-label="Remove question"
                            title="Remove question"
                          >
                            ×
                          </button>
                        </div>

                        {!question.collapsed ? (
                          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-zinc-200 dark:lg:divide-zinc-700">
                            <div className="space-y-2 lg:pr-4">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                  Prompt
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRound(round.id, (prev) => ({
                                      ...prev,
                                      textQuestions: prev.textQuestions.map((item) =>
                                        item.id === question.id
                                          ? { ...item, promptStages: [...item.promptStages, createStage()] }
                                          : item
                                      ),
                                    }))
                                  }
                                  className="rounded bg-zinc-900 px-2 py-1 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                                  aria-label="Add prompt stage"
                                  title="Add prompt stage"
                                >
                                  Add stage
                                </button>
                              </div>
                              <div className="space-y-2">
                                {question.promptStages.map((stage) => (
                                  <StageEditor
                                    key={stage.id}
                                    stage={stage}
                                    title="Stage"
                                    mediaFiles={mediaFiles}
                                    onChange={(nextStage) =>
                                      updateRound(round.id, (prev) => ({
                                        ...prev,
                                        textQuestions: prev.textQuestions.map((item) =>
                                          item.id === question.id
                                            ? {
                                                ...item,
                                                promptStages: item.promptStages.map((entry) =>
                                                  entry.id === stage.id ? nextStage : entry
                                                ),
                                              }
                                            : item
                                        ),
                                      }))
                                    }
                                    onRemove={
                                      question.promptStages.length > 1
                                        ? () =>
                                            updateRound(round.id, (prev) => ({
                                              ...prev,
                                              textQuestions: prev.textQuestions.map((item) =>
                                                item.id === question.id
                                                  ? {
                                                      ...item,
                                                      promptStages: item.promptStages.filter(
                                                        (entry) => entry.id !== stage.id
                                                      ),
                                                    }
                                                  : item
                                              ),
                                            }))
                                        : undefined
                                    }
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2 lg:pl-4">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                  Answer
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRound(round.id, (prev) => ({
                                      ...prev,
                                      textQuestions: prev.textQuestions.map((item) =>
                                        item.id === question.id
                                          ? { ...item, answerStages: [...item.answerStages, createStage()] }
                                          : item
                                      ),
                                    }))
                                  }
                                  className="rounded bg-zinc-900 px-2 py-1 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                                  aria-label="Add answer stage"
                                  title="Add answer stage"
                                >
                                  Add stage
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="px-1 text-sm font-semibold text-zinc-700 dark:text-white">
                                  Hint
                                </p>
                                <div className="group relative leading-none">
                                  <button
                                    type="button"
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                    aria-label="Hint info"
                                  >
                                    ?
                                  </button>
                                  <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-72 -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 shadow-lg group-hover:block">
                                    Used for quizmaster to help when grading answers; not visible to the players
                                  </div>
                                </div>
                                <input
                                  value={question.answerHint}
                                  onChange={(event) =>
                                    updateRound(round.id, (prev) => ({
                                      ...prev,
                                      textQuestions: prev.textQuestions.map((item) =>
                                        item.id === question.id
                                          ? { ...item, answerHint: event.target.value }
                                          : item
                                      ),
                                    }))
                                  }
                                  placeholder="Host grading hint"
                                  className={[
                                    "min-w-0 flex-1 rounded-md border bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 dark:bg-zinc-900 dark:text-zinc-100",
                                    question.answerHint.trim().length
                                      ? "border-zinc-300 focus:border-emerald-400 focus:ring-emerald-200 dark:border-zinc-700"
                                      : "border-red-300 focus:border-red-400 focus:ring-red-200 dark:border-red-800",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                />
                              </div>
                              <div className="space-y-2">
                                {question.answerStages.map((stage) => (
                                  <StageEditor
                                    key={stage.id}
                                    stage={stage}
                                    title="Stage"
                                    mediaFiles={mediaFiles}
                                    onChange={(nextStage) =>
                                      updateRound(round.id, (prev) => ({
                                        ...prev,
                                        textQuestions: prev.textQuestions.map((item) =>
                                          item.id === question.id
                                            ? {
                                                ...item,
                                                answerStages: item.answerStages.map((entry) =>
                                                  entry.id === stage.id ? nextStage : entry
                                                ),
                                              }
                                            : item
                                        ),
                                      }))
                                    }
                                    onRemove={
                                      question.answerStages.length > 1
                                        ? () =>
                                            updateRound(round.id, (prev) => ({
                                              ...prev,
                                              textQuestions: prev.textQuestions.map((item) =>
                                                item.id === question.id
                                                  ? {
                                                      ...item,
                                                      answerStages: item.answerStages.filter(
                                                        (entry) => entry.id !== stage.id
                                                      ),
                                                    }
                                                  : item
                                              ),
                                            }))
                                        : undefined
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Images</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateRound(round.id, (prev) => ({
                            ...prev,
                            imageItems: [...prev.imageItems, createImageItem()],
                          }))
                        }
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                        aria-label="Add image item"
                        title="Add image item"
                      >
                        +
                      </button>
                    </div>

                    {round.imageItems.map((item, itemIndex) => (
                      <div
                        key={item.id}
                        className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                imageItems: prev.imageItems.map((entry) =>
                                  entry.id === item.id ? { ...entry, collapsed: !entry.collapsed } : entry
                                ),
                              }))
                            }
                            className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                          >
                            {item.collapsed ? "▸" : "▾"}
                          </button>
                          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                            Image {itemIndex + 1}
                          </p>
                          <button
                            type="button"
                            onClick={() => openPreview(round.id, itemIndex)}
                            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                            aria-label="Preview image"
                            title="Preview"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                imageItems: prev.imageItems.filter((entry) => entry.id !== item.id),
                              }))
                            }
                            className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
                            aria-label="Remove image item"
                            title="Remove image item"
                          >
                            ×
                          </button>
                        </div>

                        {!item.collapsed ? (
                          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-zinc-200 dark:lg:divide-zinc-700">
                            <div className="space-y-2 lg:pr-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                Image
                              </p>
                              <MediaSelector
                                value={item.imagePath}
                                mediaFiles={mediaFiles}
                                onChange={(imagePath) =>
                                  updateRound(round.id, (prev) => ({
                                    ...prev,
                                    imageItems: prev.imageItems.map((entry) =>
                                      entry.id === item.id ? { ...entry, imagePath } : entry
                                    ),
                                  }))
                                }
                                placeholder="No image selected"
                              />
                            </div>

                            <div className="space-y-2 lg:pl-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                Answer
                              </p>
                              <div className="flex items-start gap-2">
                                <p className="w-12 px-1 text-sm font-semibold text-zinc-700 dark:text-white">
                                  Text
                                </p>
                                <textarea
                                  value={item.answerStage.text}
                                  onChange={(event) =>
                                    updateRound(round.id, (prev) => ({
                                      ...prev,
                                      imageItems: prev.imageItems.map((entry) =>
                                        entry.id === item.id
                                          ? {
                                              ...entry,
                                              answerStage: { ...entry.answerStage, text: event.target.value },
                                            }
                                          : entry
                                      ),
                                    }))
                                  }
                                  rows={3}
                                  placeholder="Optional text"
                                  className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="w-12 px-1 text-sm font-semibold text-zinc-700 dark:text-white">
                                  Media
                                </p>
                                <div className="min-w-0 flex-1">
                                  <MediaSelector
                                    value={item.answerStage.mediaPath}
                                    mediaFiles={mediaFiles}
                                    onChange={(mediaPath) =>
                                      updateRound(round.id, (prev) => ({
                                        ...prev,
                                        imageItems: prev.imageItems.map((entry) =>
                                          entry.id === item.id
                                            ? {
                                                ...entry,
                                                answerStage: { ...entry.answerStage, mediaPath },
                                              }
                                            : entry
                                        ),
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      </section>
      {previewRoundMeta ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          onClick={closePreview}
        >
          <div
            className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-3 text-white">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
                Preview
              </p>
              <button
                type="button"
                onClick={closePreview}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-sm text-zinc-100 hover:bg-zinc-600"
              >
                ×
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
              <RoundStage
                answerMediaError={null}
                displayRoundMeta={previewRoundMeta}
                finalizeScores={() => undefined}
                gradeAnswer={() => Promise.resolve()}
                gradingMatrix={[]}
                gradingTeamIndex={previewGradingTeamIndex}
                isAnswerMediaLoading={false}
                isMediaLoading={false}
                isPresentingImageRound={previewRoundMeta.type === "image"}
                mediaError={null}
                answerMediaKind={previewAnswerMediaKind}
                mediaKind={previewMediaKind}
                mediaVolume={0.2}
                presenting={previewPresentingPayload}
                presentingAnswer={previewPresentingAnswer}
                presentingAnswerMedia={previewPresentingAnswerMedia}
                presentingAnswerMediaUrl={previewPresentingAnswerMediaUrl}
                presentingMedia={previewPresentingMedia}
                presentingMediaUrl={previewPresentingMediaUrl}
                presentingQuestion={stagedPreviewQuestion}
                presentingRoundMeta={previewRoundMeta}
                setGradingTeamIndex={setPreviewGradingTeamIndex}
              />

              <footer className="border-t border-white/10 bg-black/40 px-5 py-3 text-white">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]">
                  <span className="text-zinc-300">Question:</span>
                  {!isPreviewQuestionVisible && previewQuestionsCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsPreviewQuestionVisible(true);
                        setPreviewWithAnswer(false);
                        setPreviewPromptPage(0);
                        setPreviewAnswerPage(0);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white transition hover:bg-emerald-400"
                    >
                      <EyeIcon />
                    </button>
                  ) : null}

                  {previewHasQuestion ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPreviewQuestionVisible(false);
                          setPreviewWithAnswer(false);
                          setPreviewAnswerPage(0);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500 text-white transition hover:bg-red-400"
                      >
                        <EyeOffIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (previewQuestionIndex <= 0) return;
                          setPreviewQuestionIndex((prev) => Math.max(0, prev - 1));
                          setPreviewWithAnswer(false);
                          setPreviewPromptPage(0);
                          setPreviewAnswerPage(0);
                        }}
                        disabled={previewQuestionIndex <= 0}
                        className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {"<"}
                      </button>
                      <span className="min-w-3 text-center text-zinc-100">
                        {previewQuestionIndex + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const isLast = boundedPreviewQuestionIndex >= previewQuestionsCount - 1;
                          setPreviewQuestionIndex(isLast ? 0 : previewQuestionIndex + 1);
                          setPreviewWithAnswer(false);
                          setPreviewPromptPage(0);
                          setPreviewAnswerPage(0);
                        }}
                        className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600"
                      >
                        {boundedPreviewQuestionIndex < previewQuestionsCount - 1 ? ">" : "↺"}
                      </button>

                      {previewQuestionStageCount > 1 ? (
                        <>
                          <span className="text-zinc-400">Page</span>
                          <button
                            type="button"
                            onClick={() => setPreviewPromptPage((prev) => Math.max(0, prev - 1))}
                            disabled={boundedPreviewPromptPage <= 0}
                            className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {"<"}
                          </button>
                          <span className="min-w-3 text-center text-zinc-100">
                            {boundedPreviewPromptPage + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const isLast = boundedPreviewPromptPage >= previewQuestionStageCount - 1;
                              setPreviewPromptPage(isLast ? 0 : boundedPreviewPromptPage + 1);
                            }}
                            className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600"
                          >
                            {boundedPreviewPromptPage < previewQuestionStageCount - 1 ? ">" : "↺"}
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  <div className="ml-auto flex items-center gap-2">
                    {previewHasQuestion ? (
                      <>
                        <span className="text-zinc-300">Answer:</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !previewWithAnswer;
                            setPreviewWithAnswer(next);
                            if (!next) {
                              setPreviewAnswerPage(0);
                            }
                          }}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-white transition ${
                            previewWithAnswer ? "bg-red-500 hover:bg-red-400" : "bg-amber-500 hover:bg-amber-400"
                          }`}
                        >
                          {previewWithAnswer ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                        {previewWithAnswer && previewAnswerStageCount > 1 ? (
                          <>
                            <span className="text-zinc-400">Page</span>
                            <button
                              type="button"
                              onClick={() => setPreviewAnswerPage((prev) => Math.max(0, prev - 1))}
                              disabled={boundedPreviewAnswerPage <= 0}
                              className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {"<"}
                            </button>
                            <span className="min-w-3 text-center text-zinc-100">
                              {boundedPreviewAnswerPage + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const isLast = boundedPreviewAnswerPage >= previewAnswerStageCount - 1;
                                setPreviewAnswerPage(isLast ? 0 : boundedPreviewAnswerPage + 1);
                              }}
                              className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600"
                            >
                              {boundedPreviewAnswerPage < previewAnswerStageCount - 1 ? ">" : "↺"}
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </footer>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
