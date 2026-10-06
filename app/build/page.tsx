"use client";

import { gunzipSync } from "fflate";
import { useEffect, useRef, useState } from "react";
import {
  clearBuildSnapshot,
  loadBuildSnapshot,
  saveBuildSnapshot,
} from "@/lib/build/build-page-storage";
import { createTarGz } from "@/lib/build/tar-gz";
import { readTarEntries } from "@/lib/build/tar-reader";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import quizSchema from "@/types/quiz.schema.json";
import MediaTreePanel, {
  type MediaFileNode,
  type MediaTreePanelState,
} from "@/lib/components/build/media-tree-panel";
import {
  ROOT_ID,
  type FolderNode,
  type MediaTreeFile,
} from "@/lib/components/build/media-tree-shared";
import RoundBuilderPanel, {
  type BuildRound,
} from "@/lib/components/build/round-builder-panel";

type QuizStage = {
  text?: string;
  media?: string;
};

type QuizTextRound = {
  type: "text";
  title: string;
  questions: Array<{
    prompt: { stages: QuizStage[] };
    answer: { hint: string; stages: QuizStage[] };
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

type QuizMultiStepRound = {
  type: "multi-step";
  title: string;
  pointsPerStep: number[];
  allowAnswerChanges: boolean;
  questions: Array<{
    steps: QuizStage[];
    answer: { hint: string; stages: QuizStage[] };
  }>;
};

type QuizRound = QuizTextRound | QuizImageRound | QuizMultiStepRound;

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toStage(stage?: QuizStage): {
  id: string;
  collapsed: boolean;
  text: string;
  mediaPath: string | null;
} {
  return {
    id: makeId(),
    collapsed: false,
    text: stage?.text ?? "",
    mediaPath: stage?.media ?? null,
  };
}

function normalizeBuilderStage(stage: { text: string; mediaPath: string | null }): QuizStage | null {
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

export function buildQuizFromBuilderState(rounds: BuildRound[], mediaFiles: MediaTreeFile[]): {
  quizRounds: QuizRound[];
  errors: string[];
} {
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

  const quizRounds: QuizRound[] = [];

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
          const normalized = normalizeBuilderStage(stage);
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
          const normalized = normalizeBuilderStage(stage);
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

    if (round.type === "multi-step") {
      if (!round.multiStepQuestions.length) {
        errors.push(`Round ${roundNo}: add at least one question.`);
        return;
      }

      const pointsPerStep = round.pointsPerStep.filter((points) => Number.isFinite(points));
      if (pointsPerStep.length !== round.pointsPerStep.length || !pointsPerStep.length) {
        errors.push(`Round ${roundNo}: points per step must be finite numbers.`);
      }

      const questions: QuizMultiStepRound["questions"] = [];
      round.multiStepQuestions.forEach((question, questionIndex) => {
        const qNo = questionIndex + 1;
        if (question.steps.length !== round.pointsPerStep.length) {
          errors.push(`Round ${roundNo}, question ${qNo}: step count must match points.`);
        }

        const steps: QuizStage[] = [];
        question.steps.forEach((stage, stageIndex) => {
          const normalized = normalizeBuilderStage(stage);
          if (!normalized) {
            errors.push(`Round ${roundNo}, question ${qNo}, step ${stageIndex + 1}: text or media is required.`);
            return;
          }
          if (normalized.media && !mediaByPath.has(normalized.media)) {
            errors.push(`Round ${roundNo}, question ${qNo}, step ${stageIndex + 1}: media file not found (${normalized.media}).`);
          } else if (normalized.media) {
            usedMediaPaths.add(normalized.media);
          }
          steps.push(normalized);
        });

        const answerHint = question.answerHint.trim();
        if (!answerHint) {
          errors.push(`Round ${roundNo}, question ${qNo}: hint is required.`);
        }

        const answerStages: QuizStage[] = [];
        question.answerStages.forEach((stage, stageIndex) => {
          const normalized = normalizeBuilderStage(stage);
          if (!normalized) {
            errors.push(`Round ${roundNo}, question ${qNo}, answer stage ${stageIndex + 1}: text or media is required.`);
            return;
          }
          if (normalized.media && !mediaByPath.has(normalized.media)) {
            errors.push(`Round ${roundNo}, question ${qNo}, answer stage ${stageIndex + 1}: media file not found (${normalized.media}).`);
          } else if (normalized.media) {
            usedMediaPaths.add(normalized.media);
          }
          answerStages.push(normalized);
        });

        questions.push({
          steps,
          answer: {
            hint: answerHint,
            stages: answerStages,
          },
        });
      });

      quizRounds.push({
        type: "multi-step",
        title: title || `Round ${roundNo}`,
        pointsPerStep: round.pointsPerStep,
        allowAnswerChanges: round.allowAnswerChanges,
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

      const prompt = normalizeBuilderStage(item.answerStage);
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

  return { quizRounds, errors };
}

function collectReferencedMediaPaths(rounds: QuizRound[]): Set<string> {
  const refs = new Set<string>();

  rounds.forEach((round) => {
    if (round.type === "text") {
      round.questions.forEach((question) => {
        question.prompt.stages.forEach((stage) => {
          if (stage.media) refs.add(stage.media);
        });
        question.answer.stages.forEach((stage) => {
          if (stage.media) refs.add(stage.media);
        });
      });
      return;
    }

    if (round.type === "multi-step") {
      round.questions.forEach((question) => {
        question.steps.forEach((stage) => {
          if (stage.media) refs.add(stage.media);
        });
        question.answer.stages.forEach((stage) => {
          if (stage.media) refs.add(stage.media);
        });
      });
      return;
    }

    round.questions.forEach((question) => {
      refs.add(question.image);
      if (question.prompt?.media) refs.add(question.prompt.media);
    });
  });

  return refs;
}

function mapQuizRoundsToBuildRounds(rounds: QuizRound[]): BuildRound[] {
  return rounds.map((round) => {
    if (round.type === "text") {
      return {
        id: makeId(),
        collapsed: false,
        name: round.title,
        type: "text",
        textQuestions: round.questions.map((question) => ({
          id: makeId(),
          collapsed: false,
          promptStages: question.prompt.stages.map((stage) => toStage(stage)),
          answerHint: question.answer.hint,
          answerStages: question.answer.stages.map((stage) => toStage(stage)),
        })),
        imageItems: [],
        multiStepQuestions: [],
        pointsPerStep: [1],
        allowAnswerChanges: false,
      } satisfies BuildRound;
    }

    if (round.type === "multi-step") {
      return {
        id: makeId(),
        collapsed: false,
        name: round.title,
        type: "multi-step",
        textQuestions: [],
        imageItems: [],
        multiStepQuestions: round.questions.map((question) => ({
          id: makeId(),
          collapsed: false,
          steps: question.steps.map((stage) => toStage(stage)),
          answerHint: question.answer.hint,
          answerStages: question.answer.stages.map((stage) => toStage(stage)),
        })),
        pointsPerStep: round.pointsPerStep,
        allowAnswerChanges: round.allowAnswerChanges,
      } satisfies BuildRound;
    }

    return {
      id: makeId(),
      collapsed: false,
      name: round.title,
      type: "image",
      textQuestions: [],
      imageItems: round.questions.map((question) => ({
        id: makeId(),
        collapsed: false,
        imagePath: question.image,
        answerStage: toStage(question.prompt),
      })),
      multiStepQuestions: [],
      pointsPerStep: [1],
      allowAnswerChanges: false,
    } satisfies BuildRound;
  });
}

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function ensureFolder(
  folders: Record<string, FolderNode>,
  folderParts: string[]
): string {
  let parentId = ROOT_ID;
  let acc = "";
  folderParts.forEach((part) => {
    acc = acc ? `${acc}/${part}` : part;
    const folderId = `folder:${acc}`;
    if (!folders[folderId]) {
      folders[folderId] = {
        id: folderId,
        name: part,
        parentId,
        childFolderIds: [],
        fileIds: [],
      };
      if (!folders[parentId].childFolderIds.includes(folderId)) {
        folders[parentId].childFolderIds.push(folderId);
      }
    }
    parentId = folderId;
  });
  return parentId;
}

function mapMediaEntriesToTreeState(entries: Array<{ path: string; bytes: Uint8Array }>): MediaTreePanelState {
  const folders: Record<string, FolderNode> = {
    [ROOT_ID]: {
      id: ROOT_ID,
      name: "media",
      parentId: null,
      childFolderIds: [],
      fileIds: [],
    },
  };
  const files: Record<string, MediaFileNode> = {};

  entries.forEach((entry) => {
    const parts = entry.path.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1];
    const folderParts = parts.slice(0, -1);
    const parentFolderId = ensureFolder(folders, folderParts);
    const id = makeId();
    files[id] = {
      id,
      name: fileName,
      parentFolderId,
      file: (() => {
        const buffer = new ArrayBuffer(entry.bytes.byteLength);
        new Uint8Array(buffer).set(entry.bytes);
        return new File([buffer], fileName, { type: guessMimeType(fileName) });
      })(),
    };
    folders[parentFolderId].fileIds.push(id);
  });

  return {
    folders,
    files,
    selectedFolderId: ROOT_ID,
    activeFileId: null,
    expandedFolderIds: [ROOT_ID],
    selectedFileIds: [],
  };
}

export default function BuildPage() {
  const [mediaFiles, setMediaFiles] = useState<MediaTreeFile[]>([]);
  const [ready, setReady] = useState(false);
  const [initialRounds, setInitialRounds] = useState<BuildRound[] | undefined>(undefined);
  const [initialMediaTreeState, setInitialMediaTreeState] = useState<MediaTreePanelState | undefined>(
    undefined
  );
  const [roundsState, setRoundsState] = useState<BuildRound[] | null>(null);
  const [mediaTreeState, setMediaTreeState] = useState<MediaTreePanelState | null>(null);
  const [panelRevision, setPanelRevision] = useState(0);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [loadSuccess, setLoadSuccess] = useState<string | null>(null);
  const [isLoadingPack, setIsLoadingPack] = useState(false);
  const [generateErrors, setGenerateErrors] = useState<string[]>([]);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [isGeneratingPack, setIsGeneratingPack] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const loadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const snapshot = await loadBuildSnapshot();
        if (cancelled) return;

        if (snapshot) {
          const rounds = Array.isArray(snapshot.rounds) ? (snapshot.rounds as BuildRound[]) : [];
          const mediaState = (snapshot.mediaTreeState ?? undefined) as
            | MediaTreePanelState
            | undefined;

          setInitialRounds(rounds);
          setRoundsState(rounds);

          if (mediaState) {
            setInitialMediaTreeState(mediaState);
            setMediaTreeState(mediaState);
          }
        }
      } catch {
        await clearBuildSnapshot().catch(() => undefined);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !roundsState || !mediaTreeState) return;

    const timer = window.setTimeout(() => {
      saveBuildSnapshot({
        rounds: roundsState,
        mediaTreeState,
      }).catch(() => undefined);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [mediaTreeState, ready, roundsState]);

  async function handlePackFile(file: File) {
    setLoadErrors([]);
    setLoadSuccess(null);
    setGenerateErrors([]);
    setGenerateSuccess(null);
    setIsLoadingPack(true);

    try {
      const compressed = new Uint8Array(await file.arrayBuffer());
      const tarBytes = gunzipSync(compressed);
      const entries = readTarEntries(tarBytes);

      const quizEntry = entries.find((entry) => entry.name === "quiz.json");
      if (!quizEntry) {
        setLoadErrors(["Pack is missing quiz.json at archive root."]);
        return;
      }

      const quizText = new TextDecoder().decode(quizEntry.data);
      let parsedQuiz: unknown;
      try {
        parsedQuiz = JSON.parse(quizText);
      } catch {
        setLoadErrors(["quiz.json is not valid JSON."]);
        return;
      }

      const schemaErrors = validateAgainstQuizSchema(parsedQuiz, quizSchema);
      if (schemaErrors.length) {
        setLoadErrors(schemaErrors);
        return;
      }

      const quizRounds = parsedQuiz as QuizRound[];
      const referencedMedia = collectReferencedMediaPaths(quizRounds);

      const mediaEntryMap = new Map<string, { path: string; bytes: Uint8Array }>();
      entries.forEach((entry) => {
        if (!entry.name.startsWith("media/")) return;
        const relativePath = entry.name.slice("media/".length);
        if (!relativePath) return;
        mediaEntryMap.set(relativePath, { path: relativePath, bytes: entry.data });
      });

      const errors: string[] = [];
      referencedMedia.forEach((path) => {
        if (!mediaEntryMap.has(path)) {
          errors.push(`Referenced media file is missing in archive: ${path}`);
        }
      });

      if (errors.length) {
        setLoadErrors(errors);
        return;
      }

      const nextRounds = mapQuizRoundsToBuildRounds(quizRounds);
      const nextMediaTreeState = mapMediaEntriesToTreeState([...mediaEntryMap.values()]);

      setInitialRounds(nextRounds);
      setRoundsState(nextRounds);
      setInitialMediaTreeState(nextMediaTreeState);
      setMediaTreeState(nextMediaTreeState);
      setPanelRevision((prev) => prev + 1);
      setLoadSuccess(`Loaded ${nextRounds.length} round(s) and ${mediaEntryMap.size} media file(s).`);
    } catch {
      setLoadErrors(["Failed to load pack. Make sure the file is a valid .tar.gz archive."]);
    } finally {
      setIsLoadingPack(false);
    }
  }

  async function handleGeneratePack() {
    setGenerateErrors([]);
    setGenerateSuccess(null);
    setLoadErrors([]);
    setLoadSuccess(null);

    const rounds = roundsState ?? [];
    const { quizRounds, errors } = buildQuizFromBuilderState(rounds, mediaFiles);
    if (errors.length) {
      setGenerateErrors(errors);
      return;
    }

    const schemaErrors = validateAgainstQuizSchema(quizRounds, quizSchema);
    if (schemaErrors.length) {
      setGenerateErrors(schemaErrors);
      return;
    }

    setIsGeneratingPack(true);
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = [];
      entries.push({
        name: "quiz.json",
        data: new TextEncoder().encode(`${JSON.stringify(quizRounds, null, 2)}\n`),
      });

      const allMediaFiles = [...mediaFiles].sort((a, b) => a.path.localeCompare(b.path));
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
      setIsGeneratingPack(false);
    }
  }

  async function handleResetPack() {
    setLoadErrors([]);
    setLoadSuccess(null);
    setGenerateErrors([]);
    setGenerateSuccess(null);

    const nextRounds: BuildRound[] = [];
    setInitialRounds(nextRounds);
    setRoundsState(nextRounds);
    setInitialMediaTreeState(undefined);
    setMediaTreeState(null);
    setPanelRevision((prev) => prev + 1);
    setIsResetConfirmOpen(false);

    await clearBuildSnapshot().catch(() => undefined);
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-zinc-100 p-4 dark:bg-zinc-950">
        <main className="grid min-h-[calc(100vh-2rem)] place-items-center rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Loading builder...
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-h-[40px] min-w-0 flex-1 space-y-2">
          {loadErrors.length > 0 ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              {loadErrors.map((error) => (
                <p key={`load-${error}`}>{error}</p>
              ))}
            </div>
          ) : null}
          {generateErrors.length > 0 ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              {generateErrors.map((error) => (
                <p key={`gen-${error}`}>{error}</p>
              ))}
            </div>
          ) : null}
          {loadSuccess ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              {loadSuccess}
            </div>
          ) : null}
          {generateSuccess ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              {generateSuccess}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={loadInputRef}
            type="file"
            accept=".tar.gz,application/gzip"
            className="hidden"
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!selected) return;
              handlePackFile(selected);
            }}
          />
          <button
            type="button"
            disabled={isLoadingPack || isGeneratingPack}
            onClick={() => loadInputRef.current?.click()}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isLoadingPack ? "Loading..." : "Load pack"}
          </button>
          <button
            type="button"
            onClick={handleGeneratePack}
            disabled={isGeneratingPack || isLoadingPack}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {isGeneratingPack ? "Generating..." : "Generate pack"}
          </button>
          <button
            type="button"
            onClick={() => setIsResetConfirmOpen(true)}
            disabled={isGeneratingPack || isLoadingPack}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            New pack
          </button>
        </div>
      </div>

      <main className="grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <MediaTreePanel
          key={`media-tree-${panelRevision}`}
          initialState={initialMediaTreeState}
          onMediaFilesChange={setMediaFiles}
          onStateChange={setMediaTreeState}
        />
        <RoundBuilderPanel
          key={`round-builder-${panelRevision}`}
          mediaFiles={mediaFiles}
          initialRounds={initialRounds}
          onRoundsChange={setRoundsState}
        />
      </main>

      {isResetConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Start a new pack?</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              This will clear the current builder state.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="rounded-md bg-zinc-200 px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPack}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Yes, reset
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
