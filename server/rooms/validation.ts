import { posix } from "node:path";
import { parseColorQuestion, parseColorScoring, type ColorScoring } from "@/types/color";

export type ValidatedStage = {
  text?: string;
  media?: {
    path: string;
    storagePath?: string;
    contentType?: string;
    size?: number;
    filename?: string;
  };
};

export type ValidatedTextQuestion = {
  order: number;
  promptStages: ValidatedStage[];
  answerHint: string;
  answerStages: ValidatedStage[];
};

export type ValidatedImageQuestion = {
  order: number;
  prompt: ValidatedStage | null;
  imagePath: string;
};

export type ValidatedMultiStepQuestion = {
  order: number;
  steps: ValidatedStage[];
  answerHint: string;
  answerStages: ValidatedStage[];
};

export type ValidatedTextRound = {
  allowWager?: boolean;
  order: number;
  type: "text";
  title: string;
  questions: ValidatedTextQuestion[];
};

export type ValidatedImageRound = {
  order: number;
  type: "image";
  title: string;
  questions: ValidatedImageQuestion[];
};

export type ValidatedMultiStepRound = {
  order: number;
  type: "multi-step";
  title: string;
  pointsPerStep: number[];
  allowAnswerChanges: boolean;
  questions: ValidatedMultiStepQuestion[];
};

export type ValidatedColorRound = {
  order: number;
  type: "color";
  title: string;
  scoring: ColorScoring;
  questions: Array<{ order: number; imagePath: string; initialColor: string; targetColor: string } & ({ maskPath: string; regionIds?: never } | { regionIds: string[]; maskPath?: never })>;
};

export type ValidatedRound = ValidatedTextRound | ValidatedImageRound | ValidatedMultiStepRound | ValidatedColorRound;

export const ROOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;

export const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".mp4",
  ".mov",
  ".webm",
]);

function ensureString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateMediaPath(
  mediaPathRaw: unknown,
  context: string
): { path: string } | string {
  const mediaPath =
    typeof mediaPathRaw === "string" && mediaPathRaw.trim().length
      ? mediaPathRaw.trim()
      : null;
  if (!mediaPath) {
    return `${context}: media path is required.`;
  }
  if (mediaPath.startsWith("media/") || mediaPath.startsWith("/")) {
    return `${context}: media path must be relative to the media folder (no "media/" prefix).`;
  }
  const ext = posix.extname(mediaPath).toLowerCase();
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
    return `${context}: unsupported media extension "${ext}".`;
  }
  return { path: mediaPath };
}

function validateStage(stageRaw: unknown, context: string): ValidatedStage | string {
  if (!stageRaw || typeof stageRaw !== "object") {
    return `${context}: stage must be an object.`;
  }

  const stage = stageRaw as Record<string, unknown>;
  const text = ensureString(stage.text);
  let media: ValidatedStage["media"] | undefined;

  if (stage.media !== undefined && stage.media !== null) {
    if (typeof stage.media === "string") {
      const parsed = validateMediaPath(stage.media, context);
      if (typeof parsed === "string") return parsed;
      media = parsed;
    } else if (typeof stage.media === "object") {
      const mediaObj = stage.media as Record<string, unknown>;
      const parsed = validateMediaPath(mediaObj.path, context);
      if (typeof parsed === "string") return parsed;
      media = parsed;
    } else {
      return `${context}: media must be a string path or an object with path.`;
    }
  }

  if (!text && !media) {
    return `${context}: at least one of text or media is required.`;
  }

  const next: ValidatedStage = {};
  if (text) next.text = text;
  if (media) next.media = media;
  return next;
}

function normalizeOptionalPrompt(stageRaw: unknown, context: string): ValidatedStage | null | string {
  if (stageRaw === undefined || stageRaw === null) {
    return null;
  }
  if (!stageRaw || typeof stageRaw !== "object") {
    return `${context}: stage must be an object.`;
  }
  const stageObj = stageRaw as Record<string, unknown>;
  const hasText = typeof stageObj.text === "string" && stageObj.text.trim().length > 0;
  const mediaRaw = stageObj.media;
  const hasMediaPath =
    typeof mediaRaw === "string"
      ? mediaRaw.trim().length > 0
      : !!(
          mediaRaw &&
          typeof mediaRaw === "object" &&
          typeof (mediaRaw as { path?: unknown }).path === "string" &&
          (mediaRaw as { path?: string }).path?.trim().length
        );
  if (!hasText && !hasMediaPath) {
    return null;
  }
  return validateStage(stageRaw, context);
}

function validateStages(stagesRaw: unknown, context: string): ValidatedStage[] | string {
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    return `${context}: stages array is required and cannot be empty.`;
  }

  const stages: ValidatedStage[] = [];
  for (let idx = 0; idx < stagesRaw.length; idx += 1) {
    const stage = validateStage(stagesRaw[idx], `${context}, stage ${idx + 1}`);
    if (typeof stage === "string") return stage;
    stages.push(stage);
  }

  return stages;
}

function validateAnswer(answerRaw: unknown, context: string): { hint: string; stages: ValidatedStage[] } | string {
  if (!answerRaw || typeof answerRaw !== "object") {
    return `${context}: answer object is required.`;
  }

  const answer = answerRaw as Record<string, unknown>;
  const stages = validateStages(answer.stages, `${context} answer`);
  if (typeof stages === "string") return stages;

  const hint = ensureString(answer.hint);
  if (!hint) {
    return `${context}: answer.hint is required.`;
  }

  return { hint, stages };
}

function validatePointsPerStep(pointsRaw: unknown, context: string): number[] | string {
  if (!Array.isArray(pointsRaw) || pointsRaw.length === 0) {
    return `${context}: pointsPerStep array is required and cannot be empty.`;
  }

  const points: number[] = [];
  for (let idx = 0; idx < pointsRaw.length; idx += 1) {
    const pointValue = pointsRaw[idx];
    if (typeof pointValue !== "number" || !Number.isFinite(pointValue)) {
      return `${context}: pointsPerStep ${idx + 1} must be a finite number.`;
    }
    points.push(pointValue);
  }

  return points;
}

export function validateRoomId(id: string | undefined): string | null {
  if (!id) return "Room id is required.";
  if (!ROOM_ID_REGEX.test(id)) {
    return "Room id must be 3-50 chars, lowercase letters, numbers, or dashes.";
  }
  if (id === "host") {
    return 'Room id cannot be "host".';
  }
  return null;
}

export function validateQuizFile(content: string): ValidatedRound[] | string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return "Quiz file is not valid JSON.";
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "Quiz file must be a non-empty array of rounds.";
  }

  const validatedRounds: ValidatedRound[] = [];

  for (let roundIndex = 0; roundIndex < parsed.length; roundIndex++) {
    const round = parsed[roundIndex] as Record<string, unknown>;
    const type = round?.type;
    const title = ensureString(round?.title);
    const questions = round?.questions;

    if (type !== "text" && type !== "image" && type !== "multi-step" && type !== "color") {
      return `Round ${roundIndex + 1}: unsupported round type.`;
    }

    if (!title) {
      return `Round ${roundIndex + 1}: title is required.`;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return `Round ${roundIndex + 1}: questions array is required and cannot be empty.`;
    }

    if ("allowWager" in round && (type !== "text" || typeof round.allowWager !== "boolean")) {
      return `Round ${roundIndex + 1}: allowWager must be a boolean on text rounds only.`;
    }

    if (type === "color") {
      let scoring: ColorScoring;
      try { scoring = parseColorScoring(round.scoring); }
      catch (error) { return `Round ${roundIndex + 1}: ${(error as Error).message}`; }
      const colorQuestions: ValidatedColorRound["questions"] = [];
      for (const [index, raw] of questions.entries()) {
        try {
          const q = parseColorQuestion(raw);
          const base = { order: index, imagePath: q.image, initialColor: q.initialColor, targetColor: q.targetColor };
          colorQuestions.push(q.regionIds ? { ...base, regionIds: q.regionIds } : { ...base, maskPath: q.mask });
        } catch (error) { return `Round ${roundIndex + 1}, question ${index + 1}: ${(error as Error).message}`; }
      }
      validatedRounds.push({ order: roundIndex, type, title, scoring, questions: colorQuestions });
      continue;
    }

    if (type === "text") {
      const validatedQuestions: ValidatedTextQuestion[] = [];

      for (let qIndex = 0; qIndex < questions.length; qIndex++) {
        const question = questions[qIndex] as Record<string, unknown>;
        const promptRaw = question?.prompt as Record<string, unknown> | undefined;
        if (!promptRaw || typeof promptRaw !== "object") {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: prompt object is required.`;
        }

        const promptStages = validateStages(
          promptRaw.stages,
          `Round ${roundIndex + 1}, question ${qIndex + 1} prompt`
        );
        if (typeof promptStages === "string") return promptStages;

        const answer = validateAnswer(
          question?.answer,
          `Round ${roundIndex + 1}, question ${qIndex + 1}`
        );
        if (typeof answer === "string") return answer;

        validatedQuestions.push({
          order: qIndex,
          promptStages,
          answerHint: answer.hint,
          answerStages: answer.stages,
        });
      }

      validatedRounds.push({
        order: roundIndex,
        type,
        title,
        questions: validatedQuestions,
        ...(round.allowWager === undefined ? {} : { allowWager: round.allowWager as boolean }),
      });
      continue;
    }

    if (type === "multi-step") {
      const pointsPerStep = validatePointsPerStep(
        round.pointsPerStep,
        `Round ${roundIndex + 1}`
      );
      if (typeof pointsPerStep === "string") return pointsPerStep;

      if (typeof round.allowAnswerChanges !== "boolean") {
        return `Round ${roundIndex + 1}: allowAnswerChanges boolean is required.`;
      }

      const validatedQuestions: ValidatedMultiStepQuestion[] = [];
      for (let qIndex = 0; qIndex < questions.length; qIndex++) {
        const question = questions[qIndex] as Record<string, unknown>;
        const steps = validateStages(
          question?.steps,
          `Round ${roundIndex + 1}, question ${qIndex + 1} steps`
        );
        if (typeof steps === "string") return steps;
        if (steps.length !== pointsPerStep.length) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: steps length must match pointsPerStep length.`;
        }

        const answer = validateAnswer(
          question?.answer,
          `Round ${roundIndex + 1}, question ${qIndex + 1}`
        );
        if (typeof answer === "string") return answer;

        validatedQuestions.push({
          order: qIndex,
          steps,
          answerHint: answer.hint,
          answerStages: answer.stages,
        });
      }

      validatedRounds.push({
        order: roundIndex,
        type,
        title,
        pointsPerStep,
        allowAnswerChanges: round.allowAnswerChanges,
        questions: validatedQuestions,
        ...(round.allowWager === undefined ? {} : { allowWager: round.allowWager as boolean }),
      });
      continue;
    }

    const validatedQuestions: ValidatedImageQuestion[] = [];
    for (let qIndex = 0; qIndex < questions.length; qIndex++) {
      const question = questions[qIndex] as Record<string, unknown>;
      const promptRaw = question?.prompt;
      const imageRaw = question?.image;

      const prompt = normalizeOptionalPrompt(
        promptRaw,
        `Round ${roundIndex + 1}, question ${qIndex + 1} prompt`
      );
      if (typeof prompt === "string") return prompt;

      const imagePath = validateMediaPath(
        imageRaw,
        `Round ${roundIndex + 1}, question ${qIndex + 1} image`
      );
      if (typeof imagePath === "string") return imagePath;

      validatedQuestions.push({
        order: qIndex,
        prompt,
        imagePath: imagePath.path,
      });
    }

    validatedRounds.push({
      order: roundIndex,
      type,
      title,
      questions: validatedQuestions,
    });
  }

  return validatedRounds;
}
