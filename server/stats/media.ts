import { Readable } from "node:stream";
import type { Bucket } from "@google-cloud/storage";
import { StatsError } from "./error";

const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export function mediaByteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new StatsError("invalid-range", "Unsupported media range.", 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? match[2] ? Math.min(size - 1, Number(match[2])) : size - 1 : size - 1;
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start >= size || end < start) throw new StatsError("invalid-range", "Unsupported media range.", 416);
  return { start, end };
}

/** Reuse the saved allowlist; never accept a request-controlled Storage path. */
export async function serveStatsAsset(request: Request, bucket: Bucket, asset: { storagePath: string; contentType: string | null }): Promise<Response> {
  const extension = asset.storagePath.slice(asset.storagePath.lastIndexOf(".") + 1).toLowerCase(), contentType = mime[extension];
  if (!contentType) throw new StatsError("unsupported-media", "This media format is unavailable.", 415);
  const file = bucket.file(asset.storagePath);
  let size: number;
  try { const [metadata] = await file.getMetadata(); size = Number(metadata.size); }
  catch (error) { if ((error as { code?: number }).code === 404) throw new StatsError("media-unavailable", "Historical media is unavailable.", 404); throw error; }
  if (!Number.isSafeInteger(size) || size < 0) throw new StatsError("invalid-media", "Media metadata is invalid.", 422);
  let range: ReturnType<typeof mediaByteRange>;
  try { range = mediaByteRange(request.headers.get("range"), size); }
  catch (error) {
    if (error instanceof StatsError && error.status === 416) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "no-store" } });
    throw error;
  }
  const stream = file.createReadStream(range ?? {});
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers: {
    "Content-Type": contentType, "Content-Length": String(range ? range.end - range.start + 1 : size), "Accept-Ranges": "bytes",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
  } });
}
