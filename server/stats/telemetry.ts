import { StatsError } from "./error";

/** Structured server logs only. Never pass answer text, notes, tokens, or provider email addresses. */
export async function statsOperation<T extends object>(operation: string, context: { gameId?: string; actorId?: string; personId?: string }, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await work(), value = result as Record<string, unknown>;
    const summary = value.summary as { unresolvedAppearances?: number; metrics?: { warnings?: unknown[] } } | undefined;
    console.info(JSON.stringify({ event: "stats.operation", operation, ...context, status: "success", elapsedMs: Math.round(performance.now() - started),
      ...(typeof value.version === "number" ? { version: value.version } : {}), ...(typeof value.snapshotId === "string" ? { snapshotId: value.snapshotId } : {}),
      ...(typeof value.changed === "boolean" ? { changed: value.changed } : {}), ...(typeof value.reviewDurationMs === "number" ? { reviewDurationMs: value.reviewDurationMs } : {}),
      ...(typeof value.mappingCorrections === "number" ? { mappingCorrections: value.mappingCorrections } : {}), ...(typeof value.duplicateResolutions === "number" ? { duplicateResolutions: value.duplicateResolutions } : {}),
      ...(summary ? { unresolvedAppearances: summary.unresolvedAppearances, recordedWarnings: summary.metrics?.warnings?.length ?? 0 } : {}) }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({ event: "stats.operation", operation, ...context, status: "failed", code: error instanceof StatsError ? error.code : "internal-error", elapsedMs: Math.round(performance.now() - started) }));
    throw error;
  }
}
