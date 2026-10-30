import type { StatsHistoryResult } from "@/types/stats";
import { completionTime } from "./model";

export function resultStreaks(history: StatsHistoryResult[]) {
  const gamesWithDates = history.filter((row) => row.completedAt !== null).length;
  const gamesWithKnownOutcomes = history.filter((row) => row.outcome !== "unavailable").length;
  const coverage = { gamesWithDates, gamesWithKnownOutcomes, totalGames: history.length };
  if (!history.length || gamesWithDates !== history.length || gamesWithKnownOutcomes !== history.length) {
    return { currentWins: null, longestWins: null, currentLosses: null, longestLosses: null, ...coverage };
  }
  let currentWins = 0, longestWins = 0, currentLosses = 0, longestLosses = 0;
  const ordered = [...history].sort((a, b) => completionTime(a.completedAt)! - completionTime(b.completedAt)! || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  for (const row of ordered) {
    if (row.outcome === "tie") continue;
    if (row.outcome === "win") { currentWins++; currentLosses = 0; longestWins = Math.max(longestWins, currentWins); }
    else { currentLosses++; currentWins = 0; longestLosses = Math.max(longestLosses, currentLosses); }
  }
  return { currentWins, longestWins, currentLosses, longestLosses, ...coverage };
}

export function historyExtremes(rows: Array<{ gameId: string; value: number | null }>, largest: boolean) {
  const known = rows.filter((row): row is { gameId: string; value: number } => row.value !== null);
  if (known.some((row) => !Number.isFinite(row.value))) throw new Error("Invalid history metric.");
  if (!known.length) return [];
  const extreme = known.reduce((value, row) => largest ? Math.max(value, row.value) : Math.min(value, row.value), known[0].value);
  return known.filter((row) => row.value === extreme);
}
