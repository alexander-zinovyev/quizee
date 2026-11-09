export type QuizStage = { text?: string; media?: string };
export type QuizAnswer = { hint: string; stages: QuizStage[] };

const MEDIA_PATH = /^(?!\/)(?!media\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[:\\\x00-\x1f]).+\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|ogg|m4a|aac|mp4|mov|webm)$/;
export function parseQuizStage(raw: unknown): QuizStage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "text" && key !== "media")) throw new Error("Invalid stage.");
  const stage = raw as Record<string, unknown>;
  if (stage.text !== undefined && (typeof stage.text !== "string" || !stage.text.trim())) throw new Error("Stage text must contain text.");
  if (stage.media !== undefined && (typeof stage.media !== "string" || !MEDIA_PATH.test(stage.media))) throw new Error("Stage media must be a relative path with a supported extension.");
  if (stage.text === undefined && stage.media === undefined) throw new Error("Stage needs text and/or media.");
  return { ...(stage.text === undefined ? {} : { text: (stage.text as string).trim() }), ...(stage.media === undefined ? {} : { media: stage.media as string }) };
}
