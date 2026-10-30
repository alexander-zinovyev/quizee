import { StatsError } from "./error";

export function statsPublicEnabled() {
  const value = process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("QUIZEE_STATISTICS_PUBLIC_ENABLED must be true or false.");
}

export function assertStatsPublicEnabled() {
  if (!statsPublicEnabled()) throw new StatsError("not-found", "Statistics are unavailable.", 404);
}
