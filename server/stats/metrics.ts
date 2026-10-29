import type {
  PercentageComponent, PercentageExclusion, QuestionMaximum, StatsAppearance,
  StatsHistoryResult, StatsMapping, StatsPercentage, StatsRoundScoring, StatsTeam, StatsTeamResult,
} from "@/types/stats";

/** Only score reconciliation uses tolerance. Outcomes always compare recorded numbers exactly. */
export const RECONCILIATION_TOLERANCE = 1e-9;

function finite(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function sum(values: number[]): number {
  return finite(values.reduce((total, value) => total + finite(value, "Value"), 0), "Sum");
}

export function inferQuestionMaximum(scoring: StatsRoundScoring, override?: number): QuestionMaximum {
  if (override !== undefined) {
    if (finite(override, "Maximum") < 0) throw new Error("Maximum must be nonnegative.");
    return { points: override, provenance: "admin" };
  }
  const configured = (points: number): QuestionMaximum => ({ points, provenance: "configured" });
  switch (scoring.type) {
    case "text":
      if (scoring.allowWager === null) break;
      if (typeof scoring.allowWager !== "boolean") throw new Error("Invalid wager configuration.");
      return configured(scoring.allowWager ? 2 : 1);
    case "image": return configured(1);
    case "multi-step":
      if (scoring.pointsPerStep === null) break;
      if (!Array.isArray(scoring.pointsPerStep) || !scoring.pointsPerStep.length) throw new Error("Invalid step points.");
      return configured(Math.max(0, ...scoring.pointsPerStep.map((value) => finite(value, "Step points"))));
    case "color": {
      if (scoring.scoring === null) break;
      const rule = scoring.scoring;
      if (finite(rule.points, "Color points") <= 0) throw new Error("Color points must be positive.");
      const parameter = rule.mode === "threshold" ? rule.threshold : rule.mode === "closest" ? rule.tieTolerance : NaN;
      if (finite(parameter, "Color scoring parameter") < 0 || parameter > 10) throw new Error("Invalid color scoring parameter.");
      return configured(rule.points);
    }
    default: throw new Error("Unsupported statistics round type.");
  }
  return { points: 1, provenance: "default-unverified" };
}

export function calculateOutcomes(teams: StatsTeam[]): StatsTeamResult[] {
  if (new Set(teams.map((team) => team.id)).size !== teams.length) throw new Error("Duplicate team ID.");
  teams.forEach((team) => { if (team.score !== null) finite(team.score, "Team score"); });
  if (teams.length < 2 || teams.some((team) => team.score === null)) {
    return teams.map((team) => ({ ...team, outcome: "unavailable", rank: null }));
  }
  const scores = teams.map((team) => team.score!);
  const top = Math.max(...scores);
  const sharedFirst = scores.filter((score) => score === top).length > 1;
  return teams.map((team) => ({
    ...team,
    rank: 1 + scores.filter((score) => score > team.score!).length,
    outcome: team.score === top ? sharedFirst ? "tie" : "win" : "loss",
  }));
}

export function reconcileScore(recorded: number | null, components: Array<number | null>) {
  if (recorded !== null) finite(recorded, "Recorded score");
  components.forEach((value) => { if (value !== null) finite(value, "Score component"); });
  if (recorded === null || !components.length || components.some((value) => value === null)) {
    return { status: "unavailable" as const, difference: null };
  }
  const difference = finite(recorded - sum(components as number[]), "Score difference");
  return { status: Math.abs(difference) <= RECONCILIATION_TOLERANCE ? "reconciled" as const : "mismatch" as const, difference };
}

function exclusion(component: PercentageComponent, excludeClosest: boolean): PercentageExclusion | null {
  if (component.earned !== null) finite(component.earned, "Award");
  if (finite(component.maximum.points, "Maximum") < 0) throw new Error("Maximum must be nonnegative.");
  if (!["configured", "admin", "default-unverified"].includes(component.maximum.provenance)) throw new Error("Invalid maximum provenance.");
  if (excludeClosest && component.closestPool === true) return "closest-pool";
  if (excludeClosest && component.closestPool === null) return "unknown-scoring";
  if (component.earned === null) return "missing-award";
  if (component.maximum.provenance === "default-unverified") return "unverified-maximum";
  if (component.maximum.points === 0) return "zero-maximum";
  if (component.earned > component.maximum.points) return "award-exceeds-maximum";
  if (!component.reconciled) return "unreconciled-score";
  return null;
}

/** Values are ratios, not rounded display percentages. Negative earned points remain negative. */
export function calculatePercentage(components: PercentageComponent[], mode: "ordinary" | "comparable" | "difficulty" = "ordinary"): StatsPercentage {
  const keys = components.map((part) => JSON.stringify([part.gameId, part.roundId, part.questionId, part.teamId]));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate team/question percentage input.");
  const reasons = components.map((part) => exclusion(part, mode !== "ordinary"));
  // A host comparison requires the complete non-closest question set for every participating team.
  const incompleteGames = new Set(components.filter((part, index) =>
    mode === "difficulty" && reasons[index] !== null && reasons[index] !== "closest-pool").map((part) => part.gameId));
  const included: PercentageComponent[] = [];
  const excluded: Partial<Record<PercentageExclusion, number>> = {};
  components.forEach((part, index) => {
    const reason = reasons[index] ?? (incompleteGames.has(part.gameId) ? "incomplete-game" : null);
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else included.push(part);
  });
  const count = (parts: PercentageComponent[], key: (part: PercentageComponent) => unknown[]) =>
    new Set(parts.map((part) => JSON.stringify(key(part)))).size;
  const numerator = sum(included.map((part) => part.earned!));
  const denominator = sum(included.map((part) => part.maximum.points));
  const value = denominator > 0 ? finite(numerator / denominator, "Percentage") : null;
  return {
    numerator, denominator, value,
    coverage: {
      eligibleQuestionTeams: included.length, totalQuestionTeams: components.length,
      eligibleQuestions: count(included, (part) => [part.gameId, part.roundId, part.questionId]),
      totalQuestions: count(components, (part) => [part.gameId, part.roundId, part.questionId]),
      eligibleTeams: count(included, (part) => [part.gameId, part.teamId]),
      totalTeams: count(components, (part) => [part.gameId, part.teamId]),
      eligibleGames: count(included, (part) => [part.gameId]), totalGames: count(components, (part) => [part.gameId]),
      provisionalGames: count(included.filter((part) => part.provisional), (part) => [part.gameId]), excluded,
    },
  };
}

export function summarizePlayerResults(history: StatsHistoryResult[]) {
  if (new Set(history.map((row) => row.gameId)).size !== history.length) throw new Error("Duplicate player game.");
  const count = (outcome: StatsHistoryResult["outcome"]) => history.filter((row) => row.outcome === outcome).length;
  if (history.some((row) => !["win", "tie", "loss", "unavailable"].includes(row.outcome))) throw new Error("Invalid outcome.");
  const gamesPlayed = history.length;
  const wins = count("win"), ties = count("tie"), losses = count("loss"), resultsUnavailable = count("unavailable");
  const knownPoints = history.filter((row) => row.teamPoints !== null);
  const teamPoints = sum(knownPoints.map((row) => row.teamPoints!));
  return {
    gamesPlayed, wins, ties, losses, resultsUnavailable,
    winRate: gamesPlayed > 0 && resultsUnavailable === 0 ? wins / gamesPlayed : null,
    teamPoints: knownPoints.length ? teamPoints : null, gamesWithKnownPoints: knownPoints.length,
    averageTeamPoints: knownPoints.length ? teamPoints / knownPoints.length : null,
    provisionalGames: history.filter((row) => row.provisional).length,
  };
}

/** Validate explicit duplicate resolution. No identity is inferred from an alias. */
export function canonicalPlayerMappings(appearances: StatsAppearance[], mappings: Record<string, StatsMapping>) {
  const byId = new Map(appearances.map((appearance) => [appearance.id, appearance]));
  if (byId.size !== appearances.length) throw new Error("Duplicate appearance ID.");
  for (const id of Object.keys(mappings)) if (!byId.has(id)) throw new Error("Mapping references an unknown appearance.");
  const people = new Set<string>();
  const result: Array<{ personId: string; appearanceId: string; teamId: string; aliases: string[] }> = [];
  for (const appearance of appearances) {
    const mapping = mappings[appearance.id];
    if (!mapping || mapping.personId === null) {
      if (mapping?.duplicateOf !== null && mapping?.duplicateOf !== undefined) throw new Error("An unresolved appearance cannot be a duplicate.");
      continue;
    }
    if (!mapping.personId) throw new Error("Person ID is required.");
    if (mapping.duplicateOf !== null) {
      const canonical = byId.get(mapping.duplicateOf);
      const target = mappings[mapping.duplicateOf];
      if (!canonical || canonical.id === appearance.id || target?.duplicateOf !== null ||
          target.personId !== mapping.personId || canonical.teamId !== appearance.teamId || !appearance.teamId) {
        throw new Error("Duplicate must reference the same person's canonical appearance on the same team.");
      }
      continue;
    }
    if (people.has(mapping.personId)) throw new Error("A person must have one canonical player appearance per game.");
    people.add(mapping.personId);
    if (appearance.teamId === null) continue;
    result.push({ personId: mapping.personId, appearanceId: appearance.id, teamId: appearance.teamId,
      aliases: [...new Set(appearances.filter((other) => other.id === appearance.id ||
        mappings[other.id]?.duplicateOf === appearance.id).map((other) => other.alias).filter((alias): alias is string => alias !== null))] });
  }
  return result;
}

export function median(values: number[]): number | null {
  const sorted = values.map((value) => finite(value, "Median input")).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}
