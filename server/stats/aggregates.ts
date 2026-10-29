import type { StatsPercentage } from "@/types/stats";
import { sortNumber, type StatsHostContribution, type StatsPlayerContribution, type StatsSortMap } from "./model";

export type StatsAggregate = { counters: Record<string, number>; sort: StatsSortMap };
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;

function percentageCounters(percentage: StatsPercentage, prefix: string): Record<string, number> {
  return {
    [`${prefix}Earned`]: percentage.numerator, [`${prefix}Available`]: percentage.denominator,
    [`${prefix}EligibleGames`]: percentage.coverage.eligibleGames, [`${prefix}TotalGames`]: percentage.coverage.totalGames,
    [`${prefix}EligibleQuestionTeams`]: percentage.coverage.eligibleQuestionTeams, [`${prefix}TotalQuestionTeams`]: percentage.coverage.totalQuestionTeams,
    [`${prefix}EligibleQuestions`]: percentage.coverage.eligibleQuestions, [`${prefix}TotalQuestions`]: percentage.coverage.totalQuestions,
    [`${prefix}EligibleTeams`]: percentage.coverage.eligibleTeams, [`${prefix}TotalTeams`]: percentage.coverage.totalTeams,
    [`${prefix}ProvisionalGames`]: percentage.coverage.provisionalGames,
    ...Object.fromEntries(Object.entries(percentage.coverage.excluded).map(([key, value]) => [`${prefix}Excluded:${key}`, value])),
  };
}

export function playerCounters(row: StatsPlayerContribution | null): Record<string, number> {
  if (!row) return {};
  return {
    gamesPlayed: 1, wins: row.outcome === "win" ? 1 : 0, ties: row.outcome === "tie" ? 1 : 0,
    losses: row.outcome === "loss" ? 1 : 0, resultsUnavailable: row.outcome === "unavailable" ? 1 : 0,
    teamPoints: row.teamPoints ?? 0, knownPointGames: row.teamPoints === null ? 0 : 1, provisionalGames: row.provisional ? 1 : 0,
    gamePercentageSum: row.percentage.value ?? 0, knownGamePercentages: row.percentage.value === null ? 0 : 1,
    ...percentageCounters(row.percentage, "percentage"), ...percentageCounters(row.poolPercentage, "pool"),
    ...Object.fromEntries(Object.entries(row.byRoundType).flatMap(([type, data]) => Object.entries({
      ...percentageCounters(data.percentage, `round:${type}:`), ...percentageCounters(data.poolPercentage, `round:${type}:pool:`),
    }))),
  };
}

export function hostCounters(row: StatsHostContribution | null): Record<string, number> {
  if (!row) return {};
  return { gamesHosted: 1, provisionalGames: row.provisional ? 1 : 0, winningScoreSum: row.uniqueWinningScore ?? 0,
    gamesWithUniqueWinner: row.uniqueWinningScore === null ? 0 : 1, ...percentageCounters(row.difficulty, "difficulty") };
}

function replaceCounters(current: Record<string, number>, previous: Record<string, number>, next: Record<string, number>) {
  const result = { ...current };
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const delta = (next[key] ?? 0) - (previous[key] ?? 0);
    const value = (current[key] ?? 0) + delta;
    if (!Number.isFinite(value)) throw new Error("Invalid aggregate counter.");
    result[key] = value;
  }
  for (const key of ["gamesPlayed", "gamesHosted", "wins", "ties", "losses", "resultsUnavailable", "knownPointGames", "provisionalGames", "gamesWithUniqueWinner"]) {
    if (result[key] !== undefined && (!Number.isSafeInteger(result[key]) || result[key] < 0)) throw new Error("Aggregate counts are inconsistent.");
  }
  // The sum of an empty contribution set is exactly zero, including after fractional removals.
  if (result.gamesPlayed === 0 || result.gamesHosted === 0) for (const key of Object.keys(result)) result[key] = 0;
  return result;
}

export function playerSummary(c: Record<string, number>) {
  const played = c.gamesPlayed ?? 0, unknown = c.resultsUnavailable ?? 0, known = c.knownPointGames ?? 0;
  return { gamesPlayed: played, wins: c.wins ?? 0, ties: c.ties ?? 0, losses: c.losses ?? 0, resultsUnavailable: unknown,
    winRate: unknown ? null : ratio(c.wins ?? 0, played), teamPoints: known ? c.teamPoints ?? 0 : null,
    gamesWithKnownPoints: known, averageTeamPoints: ratio(c.teamPoints ?? 0, known),
    pointPercentage: ratio(c.percentageEarned ?? 0, c.percentageAvailable ?? 0),
    averageGamePercentage: ratio(c.gamePercentageSum ?? 0, c.knownGamePercentages ?? 0), provisionalGames: c.provisionalGames ?? 0 };
}

export function hostSummary(c: Record<string, number>) {
  return { gamesHosted: c.gamesHosted ?? 0, provisionalGames: c.provisionalGames ?? 0,
    difficulty: ratio(c.difficultyEarned ?? 0, c.difficultyAvailable ?? 0),
    averageWinningScore: ratio(c.winningScoreSum ?? 0, c.gamesWithUniqueWinner ?? 0), gamesWithUniqueWinner: c.gamesWithUniqueWinner ?? 0 };
}

export function replacePlayerAggregate(current: StatsAggregate | null, previous: StatsPlayerContribution | null, next: StatsPlayerContribution | null): StatsAggregate {
  const counters = replaceCounters(current?.counters ?? {}, playerCounters(previous), playerCounters(next));
  const summary = playerSummary(counters);
  return { counters, sort: Object.fromEntries(["gamesPlayed", "wins", "winRate", "ties", "losses", "teamPoints", "pointPercentage"].map((key) =>
    [key, sortNumber(summary[key as keyof typeof summary])])) };
}

export function replaceHostAggregate(current: StatsAggregate | null, previous: StatsHostContribution | null, next: StatsHostContribution | null): StatsAggregate {
  const counters = replaceCounters(current?.counters ?? {}, hostCounters(previous), hostCounters(next));
  const summary = hostSummary(counters);
  return { counters, sort: { gamesHosted: sortNumber(summary.gamesHosted), difficulty: sortNumber(summary.difficulty) } };
}
