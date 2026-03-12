"use client";

import { useEffect, useMemo, useState } from "react";
import quizSchema from "@/types/quiz.schema.json";
import { createTarGz } from "@/lib/build/tar-gz";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import type { MediaTreeFile } from "@/lib/components/build/media-tree-shared";
import MediaSelector from "@/lib/components/build/media-selector";

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

type QuizStage = {
  text?: string;
  media?: string;
};

type QuizTextRound = {
  type: "text";
  title: string;
  questions: Array<{
    prompt: {
      stages: QuizStage[];
    };
    answer: {
      hint: string;
      stages: QuizStage[];
    };
  }>;
};

type QuizImageRound = {
  type: "image";
  title: string;
  questions: Array<{
    prompt?: QuizStage;
    image: string;
  }>;
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

function sanitizeStage(stage: Stage): QuizStage | null {
  const text = stage.text.trim();
  const media = stage.mediaPath?.trim() ?? "";
  if (!text && !media) {
    return null;
  }
  const next: QuizStage = {};
  if (text) next.text = text;
  if (media) next.media = media;
  return next;
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateErrors, setGenerateErrors] = useState<string[]>([]);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

  const roundCountLabel = useMemo(() => `${rounds.length} round${rounds.length === 1 ? "" : "s"}`, [rounds.length]);

  useEffect(() => {
    onRoundsChange?.(rounds);
  }, [onRoundsChange, rounds]);

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

  async function handleGeneratePack() {
    setGenerateErrors([]);
    setGenerateSuccess(null);

    const errors: string[] = [];
    const mediaByPath = new Map<string, MediaTreeFile>();
    const usedMediaPaths = new Set<string>();
    mediaFiles.forEach((file) => {
      if (mediaByPath.has(file.path)) {
        errors.push(`Duplicate media path: ${file.path}`);
      } else {
        mediaByPath.set(file.path, file);
      }
    });

    if (!rounds.length) {
      errors.push("Add at least one round.");
    }

    const quizRounds: Array<QuizTextRound | QuizImageRound> = [];

    rounds.forEach((round, roundIndex) => {
      const roundNo = roundIndex + 1;
      const title = round.name.trim();
      if (!title) {
        errors.push(`Round ${roundNo}: name is required.`);
      }

      if (round.type === "text") {
        if (!round.textQuestions.length) {
          errors.push(`Round ${roundNo}: add at least one question.`);
          return;
        }

        const questions: QuizTextRound["questions"] = [];
        round.textQuestions.forEach((question, questionIndex) => {
          const qNo = questionIndex + 1;
          const promptStages: QuizStage[] = [];
          question.promptStages.forEach((stage, stageIndex) => {
            const normalized = sanitizeStage(stage);
            if (!normalized) {
              errors.push(`Round ${roundNo}, question ${qNo}, prompt stage ${stageIndex + 1}: text or media is required.`);
              return;
            }
            if (normalized.media && !mediaByPath.has(normalized.media)) {
              errors.push(
                `Round ${roundNo}, question ${qNo}, prompt stage ${stageIndex + 1}: media file not found (${normalized.media}).`
              );
            } else if (normalized.media) {
              usedMediaPaths.add(normalized.media);
            }
            promptStages.push(normalized);
          });

          const answerHint = question.answerHint.trim();
          if (!answerHint) {
            errors.push(`Round ${roundNo}, question ${qNo}: hint is required.`);
          }

          const answerStages: QuizStage[] = [];
          question.answerStages.forEach((stage, stageIndex) => {
            const normalized = sanitizeStage(stage);
            if (!normalized) {
              errors.push(`Round ${roundNo}, question ${qNo}, answer stage ${stageIndex + 1}: text or media is required.`);
              return;
            }
            if (normalized.media && !mediaByPath.has(normalized.media)) {
              errors.push(
                `Round ${roundNo}, question ${qNo}, answer stage ${stageIndex + 1}: media file not found (${normalized.media}).`
              );
            } else if (normalized.media) {
              usedMediaPaths.add(normalized.media);
            }
            answerStages.push(normalized);
          });

          questions.push({
            prompt: { stages: promptStages },
            answer: {
              hint: answerHint,
              stages: answerStages,
            },
          });
        });

        quizRounds.push({
          type: "text",
          title: title || `Round ${roundNo}`,
          questions,
        });
        return;
      }

      if (!round.imageItems.length) {
        errors.push(`Round ${roundNo}: add at least one image.`);
        return;
      }

      const questions: QuizImageRound["questions"] = [];
      round.imageItems.forEach((item, itemIndex) => {
        const qNo = itemIndex + 1;
        const imagePath = item.imagePath?.trim() ?? "";
        if (!imagePath) {
          errors.push(`Round ${roundNo}, image ${qNo}: image is required.`);
          return;
        }
        if (!mediaByPath.has(imagePath)) {
          errors.push(`Round ${roundNo}, image ${qNo}: media file not found (${imagePath}).`);
        } else {
          usedMediaPaths.add(imagePath);
        }

        const prompt = sanitizeStage(item.answerStage);
        if (prompt?.media && !mediaByPath.has(prompt.media)) {
          errors.push(`Round ${roundNo}, image ${qNo}: prompt media file not found (${prompt.media}).`);
        } else if (prompt?.media) {
          usedMediaPaths.add(prompt.media);
        }

        questions.push(prompt ? { prompt, image: imagePath } : { image: imagePath });
      });

      quizRounds.push({
        type: "image",
        title: title || `Round ${roundNo}`,
        questions,
      });
    });

    mediaByPath.forEach((_file, path) => {
      if (!usedMediaPaths.has(path)) {
        errors.push(`Unused media file: ${path}`);
      }
    });

    if (errors.length) {
      setGenerateErrors(errors);
      return;
    }

    const schemaErrors = validateAgainstQuizSchema(quizRounds, quizSchema);
    if (schemaErrors.length) {
      setGenerateErrors(schemaErrors);
      return;
    }

    setIsGenerating(true);
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      const quizBytes = new TextEncoder().encode(`${JSON.stringify(quizRounds, null, 2)}\n`);
      entries.push({ name: "quiz.json", data: quizBytes });

      const allMediaFiles = [...mediaByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
      for (const mediaFile of allMediaFiles) {
        const bytes = new Uint8Array(await mediaFile.file.arrayBuffer());
        entries.push({
          name: `media/${mediaFile.path}`,
          data: bytes,
        });
      }

      const archive = createTarGz(entries);
      const archiveBuffer = new ArrayBuffer(archive.byteLength);
      new Uint8Array(archiveBuffer).set(archive);
      const blob = new Blob([archiveBuffer], { type: "application/gzip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "quiz-pack.tar.gz";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setGenerateSuccess("Pack generated and downloaded.");
    } catch {
      setGenerateErrors(["Failed to generate pack."]);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">
            Round builder
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{roundCountLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addRound}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
            aria-label="Add round"
            title="Add round"
          >
            Add round
          </button>
          <button
            type="button"
            onClick={handleGeneratePack}
            disabled={isGenerating}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            aria-label="Generate pack"
            title="Generate pack"
          >
            {isGenerating ? "Generating..." : "Generate pack"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {generateErrors.length ? (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {generateErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}
        {generateSuccess ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            {generateSuccess}
          </div>
        ) : null}

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
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                textQuestions: prev.textQuestions.filter((item) => item.id !== question.id),
                              }))
                            }
                            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
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
                            onClick={() =>
                              updateRound(round.id, (prev) => ({
                                ...prev,
                                imageItems: prev.imageItems.filter((entry) => entry.id !== item.id),
                              }))
                            }
                            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
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
  );
}
