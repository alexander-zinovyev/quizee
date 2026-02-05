import { posix } from "node:path";

export type ValidatedQuestion = {
  order: number;
  prompt: string | null;
  media?: {
    path: string;
    autoplay: boolean;
    storagePath?: string;
    contentType?: string;
    size?: number;
    filename?: string;
  };
  answer: string;
};

export type ValidatedRound = {
  order: number;
  type: "text" | "image";
  title: string;
  questions: ValidatedQuestion[];
};

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
  ".mp4",
  ".mov",
  ".webm",
]);

function ensureString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

    if (type !== "text" && type !== "image") {
      return `Round ${roundIndex + 1}: only "text" or "image" rounds are supported right now.`;
    }

    if (!title) {
      return `Round ${roundIndex + 1}: title is required.`;
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return `Round ${roundIndex + 1}: questions array is required and cannot be empty.`;
    }

    const validatedQuestions: ValidatedQuestion[] = [];

    for (let qIndex = 0; qIndex < questions.length; qIndex++) {
      const question = questions[qIndex] as Record<string, unknown>;
      const promptRaw = ensureString(question?.prompt);
      const mediaRaw = question?.media as Record<string, unknown> | undefined;
      const answerRaw = question?.answer;
      const answer = typeof answerRaw === "string" ? answerRaw.trim() : "";
      const mediaPathRaw = mediaRaw?.path;
      const mediaAutoplayRaw = mediaRaw?.autoplay;
      let media: ValidatedQuestion["media"] | undefined;
      if (mediaRaw) {
        const mediaPath =
          typeof mediaPathRaw === "string" && mediaPathRaw.trim().length
            ? mediaPathRaw.trim()
            : null;
        if (!mediaPath) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: media.path is required when media is provided.`;
        }
        if (mediaPath.startsWith("media/") || mediaPath.startsWith("/")) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: media.path must be relative to the media folder (no "media/" prefix).`;
        }
        const ext = posix.extname(mediaPath).toLowerCase();
        if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: unsupported media extension "${ext}".`;
        }
        media = {
          path: mediaPath,
          autoplay: typeof mediaAutoplayRaw === "boolean" ? mediaAutoplayRaw : false,
        };
      }
      const prompt = promptRaw ?? null;

      if (type === "text") {
        if (!prompt && !media) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: either prompt or media is required.`;
        }
        if (!answer.trim()) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: answer is required.`;
        }
      } else if (type === "image") {
        if (!media) {
          return `Round ${roundIndex + 1}, question ${qIndex + 1}: media is required for image rounds.`;
        }
      }

      validatedQuestions.push({
        order: qIndex,
        prompt,
        media,
        answer,
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
