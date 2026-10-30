import type { PublicStatsGame, StatsGameMetrics, StatsHistoryResult, StatsPercentage, StatsReview } from "@/types/stats";

export const STATS_NAMESPACE = "global";
export const STATS_ROOT = `stats/${STATS_NAMESPACE}`;
export const STATS_SCHEMA_VERSION = 1;

export function statsId(id: string): string {
  if (typeof id !== "string" || !id || id === "." || id === ".." || id.includes("/") ||
      /^__.*__$/.test(id) || new TextEncoder().encode(id).length > 1500) throw new Error("Invalid statistics document ID.");
  return id;
}

export const statsPaths = {
  game: (id: string) => `${STATS_ROOT}/games/${statsId(id)}`,
  snapshot: (gameId: string, id: string) => `${STATS_ROOT}/games/${statsId(gameId)}/snapshots/${statsId(id)}`,
  person: (id: string) => `${STATS_ROOT}/people/${statsId(id)}`,
  playerGame: (personId: string, gameId: string) => `${STATS_ROOT}/people/${statsId(personId)}/playerGames/${statsId(gameId)}`,
  hostedGame: (personId: string, gameId: string) => `${STATS_ROOT}/people/${statsId(personId)}/hostedGames/${statsId(gameId)}`,
  audit: (id: string) => `${STATS_ROOT}/audit/${statsId(id)}`,
};

/** Both fields must exist, including for unknown values, or Firestore ordering drops the row. */
export type StatsSortValue = { availability: 0 | 1; value: number | string };
export type StatsSortMap = Record<string, StatsSortValue>;

export function sortNumber(value: number | null): StatsSortValue {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid numeric sort value.");
  return { availability: value === null ? 1 : 0, value: value ?? 0 };
}

export function normalizeStatsName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function sortText(value: string | null): StatsSortValue {
  if (value !== null && (typeof value !== "string" || !value.trim())) throw new Error("Invalid text sort value.");
  return { availability: value === null ? 1 : 0, value: value === null ? "" : normalizeStatsName(value) };
}

/** Persist numeric timestamps, with completion date kept distinct from snapshot/publication time. */
export function completionTime(value: string | null): number | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Completion date must be a canonical UTC timestamp.");
  return Date.parse(value);
}

export type StatsGameRecord = {
  schemaVersion: 1;
  snapshotId: string;
  version: number;
  published: boolean;
  publishedAt: string | null;
  queueTags: string[];
  /** Host/metadata fields only. Mappings and overrides use their own child documents. */
  review: Pick<StatsReview, "hostPersonId" | "completedAt" | "packLabel">;
  summary: { sort: StatsSortMap; unresolvedAppearances: number; provisional: boolean; metrics?: StatsGameMetrics };
};

export type StatsSnapshotRecord = {
  schemaVersion: 1;
  digest: string;
  snapshotAt: string;
  sourceReadAt: string;
  state: "ended";
  ready: boolean;
  documentCount: number;
};

/** Replace old contribution counters transactionally, using new - old, never current room data. */
export type StatsPlayerContribution = StatsHistoryResult & {
  namespace: typeof STATS_NAMESPACE;
  personId: string;
  gameVersion: number;
  teamId: string;
  aliases: string[];
  aliasesNormalized: string[];
  roster: Array<{ personId: string; teamId: string }>;
  rosterCoverage: { mapped: number; total: number };
  percentage: StatsPercentage;
  poolPercentage: StatsPercentage;
  byRoundType: Record<string, { percentage: StatsPercentage; poolPercentage: StatsPercentage }>;
  sort: StatsSortMap;
};

export type StatsHostContribution = {
  namespace: typeof STATS_NAMESPACE;
  personId: string;
  gameId: string;
  gameVersion: number;
  completedAt: string | null;
  alias: string | null;
  aliasesNormalized: string[];
  difficulty: StatsPercentage;
  teamPercentages: number[];
  uniqueWinningScore: number | null;
  provisional: boolean;
  sort: StatsSortMap;
};

export type StatsPersonRecord = {
  schemaVersion: 1;
  version: number;
  displayName: string;
  searchName: string;
  helperAliasesNormalized: string[];
  helperAliases: string[];
  notes: string;
  mappingCount: number;
  archived: boolean;
  hasPlayerHistory: boolean;
  hasHostHistory: boolean;
  player: { sort: StatsSortMap; counters: Record<string, number> };
  host: { sort: StatsSortMap; counters: Record<string, number> };
  createdBy: string;
  creationFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export function gameSortValues(game: Pick<PublicStatsGame, "completedAt" | "host" | "packLabel" | "teams">): StatsSortMap {
  const scores = game.teams.map((team) => team.score);
  scores.forEach((score) => sortNumber(score));
  const known = scores.filter((score): score is number => score !== null).sort((a, b) => b - a);
  const complete = known.length === scores.length;
  return {
    date: sortNumber(completionTime(game.completedAt)), host: sortText(game.host?.alias ?? null),
    pack: sortText(game.packLabel),
    topScore: sortNumber(complete && known.length ? known[0] : null),
    totalScore: sortNumber(complete && known.length ? known.reduce((total, score) => total + score, 0) : null),
    margin: sortNumber(complete && known.length >= 2 ? known[0] - known[1] : null),
  };
}
