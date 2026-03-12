"use client";

import { useEffect, useMemo, useState } from "react";
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

  return (
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
