import { RoomOperationError } from "./operation-error";

const mediaTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
export function clueMediaType(path: string): string {
  const type = mediaTypes[path.split(".").at(-1) ?? ""];
  if (!type) throw new RoomOperationError("Unsupported clue media.", 400);
  return type;
}
export type StoredClueStage = { text?: string | null; media?: { storagePath: string; filename: string; contentType?: string } | null };
