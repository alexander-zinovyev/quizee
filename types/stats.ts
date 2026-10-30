import type { ColorScoring } from "./color";

export type StatsRoundScoring =
  | { type: "text"; allowWager: boolean | null }
  | { type: "image" }
  | { type: "multi-step"; pointsPerStep: number[] | null }
  | { type: "color"; scoring: ColorScoring | null };

export type QuestionMaximum = {
  points: number;
  provenance: "configured" | "admin" | "default-unverified";
};

export type StatsOutcome = "win" | "tie" | "loss" | "unavailable";
export type StatsTeam = { id: string; name: string | null; score: number | null };
export type StatsTeamResult = StatsTeam & { outcome: StatsOutcome; rank: number | null };

/** Asset IDs are resolved through the selected snapshot's private asset allowlist. */
export type StatsStage = { text: string | null; assetId: string | null };
export type StatsRecordedAnswer = {
  /** null means absent; an empty string is an explicitly recorded blank answer. */
  answer: string | null;
  attempts: Array<{ answer: string; step: number }>;
  correctness: boolean | null;
  awardedPoints: number | null;
  /** Present only when a private snapshot recovered the pre-stages boolean grading layout. */
  awardedPointsProvenance?: "legacy-correctness";
  perceptionScore: number | null;
  assetId: string | null;
};

export type StatsQuestion = {
  id: string;
  order: number;
  prompt: StatsStage[];
  acceptedAnswer: StatsStage[];
  answerHint: string | null;
  color: { initialColor: string | null; targetColor: string | null; maskAssetId: string | null; regionIds: string[] | null } | null;
  answers: Record<string, StatsRecordedAnswer>;
};

export type StatsRound = {
  id: string;
  order: number;
  title: string;
  scoring: StatsRoundScoring;
  gradingIncomplete: boolean | null;
  questionCount: number | null;
  teamScores: Record<string, number | null>;
  questions: StatsQuestion[];
};

export type StatsAppearance = { id: string; alias: string | null; teamId: string | null };

/** Private normalized source contract. Never serialize a snapshot directly to the public. */
export type StatsSnapshot = {
  schemaVersion: 1;
  id: string;
  gameId: string;
  state: "ended";
  snapshotAt: string;
  digest: string;
  completedAt: string | null;
  packLabel: string | null;
  title: string;
  host: { appearanceId: string; alias: string | null } | null;
  appearances: StatsAppearance[];
  teams: StatsTeam[];
  rounds: StatsRound[];
  sourceMembers: Record<string, string>;
  assets: Record<string, { storagePath: string; contentType: string | null }>;
};

export type StatsMapping = {
  personId: string | null;
  /** Same-person memberships on the same team must select one canonical appearance. */
  duplicateOf: string | null;
};

export type StatsReview = {
  hostPersonId: string | null;
  mappings: Record<string, StatsMapping>;
  /** Nested maps avoid collisions between round/question IDs. */
  maxima: Record<string, Record<string, number>>;
  completedAt: string | null;
  packLabel: string | null;
};

export type PercentageExclusion =
  | "missing-award"
  | "unverified-maximum"
  | "zero-maximum"
  | "award-exceeds-maximum"
  | "unreconciled-score"
  | "closest-pool"
  | "unknown-scoring"
  | "incomplete-game";

/** One team/question pair. All keys are scoped to this component's game. */
export type PercentageComponent = {
  gameId: string;
  roundId: string;
  questionId: string;
  teamId: string;
  earned: number | null;
  maximum: QuestionMaximum;
  /** null means historical color scoring mode is unknown. */
  closestPool: boolean | null;
  reconciled: boolean;
  provisional: boolean;
};

export type StatsPercentage = {
  numerator: number;
  denominator: number;
  value: number | null;
  coverage: {
    eligibleQuestionTeams: number;
    totalQuestionTeams: number;
    eligibleQuestions: number;
    totalQuestions: number;
    eligibleTeams: number;
    totalTeams: number;
    eligibleGames: number;
    totalGames: number;
    provisionalGames: number;
    excluded: Partial<Record<PercentageExclusion, number>>;
  };
};

export type StatsHistoryResult = {
  gameId: string;
  completedAt: string | null;
  outcome: StatsOutcome;
  teamPoints: number | null;
  provisional: boolean;
};

export type StatsGameWarning = { code: string; roundId?: string; questionId?: string; teamId?: string; difference?: number };
export type StatsRoundMetrics = {
  id: string;
  title: string;
  type: string;
  closestPool: boolean | null;
  teams: Record<string, { score: number | null; percentage: StatsPercentage;
    reconciliation: { status: "reconciled" | "mismatch" | "unavailable"; difference: number | null };
    answers: { recorded: number; unanswered: number; knownCorrectness: number; incorrect: number; total: number } }>;
};
export type StatsGameMetrics = {
  results: StatsTeamResult[];
  percentage: StatsPercentage;
  poolPercentage: StatsPercentage;
  difficulty: StatsPercentage;
  rounds: StatsRoundMetrics[];
  warnings: StatsGameWarning[];
  comparisons: {
    closestRounds: string[];
    largestSwings: Array<{ roundId: string; teams: [string, string]; change: number }>;
    highestRoundTeams: Array<{ roundId: string; teamId: string; score: number }>;
    lowestRoundTeams: Array<{ roundId: string; teamId: string; score: number }>;
  };
};

/** Public summaries are explicit allowlists, independent of private source/account records. */
export type PublicStatsPerson = {
  id: string;
  displayName: string;
  hasPlayerHistory: boolean;
  hasHostHistory: boolean;
};

export type PublicStatsGame = {
  id: string;
  version: number;
  title: string;
  snapshotAt: string;
  publishedAt: string;
  completedAt: string | null;
  packLabel: string | null;
  host: { personId: string | null; alias: string | null; displayName?: string | null } | null;
  teams: StatsTeamResult[];
  unresolvedAppearances: number;
  provisional: boolean;
};

export type StatsList<T> = {
  items: T[];
  nextCursor: string | null;
  sort: string;
  direction: "asc" | "desc";
};
