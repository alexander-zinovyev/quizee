import type { PublicStatsPerson, StatsGameMetrics, StatsPercentage, StatsQuestion } from "@/types/stats";
import type { StatsPersonRecord } from "./model";

export function publicPerson(id: string, person: StatsPersonRecord): PublicStatsPerson {
  return { id, displayName: person.displayName, hasPlayerHistory: person.hasPlayerHistory, hasHostHistory: person.hasHostHistory };
}

const exclusions = ["missing-award", "unverified-maximum", "zero-maximum", "award-exceeds-maximum", "unreconciled-score", "closest-pool", "unknown-scoring", "incomplete-game"] as const;
export function publicPercentage(raw: StatsPercentage): StatsPercentage {
  const c = raw.coverage;
  return { numerator: raw.numerator, denominator: raw.denominator, value: raw.value, coverage: {
    eligibleQuestionTeams: c.eligibleQuestionTeams, totalQuestionTeams: c.totalQuestionTeams,
    eligibleQuestions: c.eligibleQuestions, totalQuestions: c.totalQuestions, eligibleTeams: c.eligibleTeams, totalTeams: c.totalTeams,
    eligibleGames: c.eligibleGames, totalGames: c.totalGames, provisionalGames: c.provisionalGames,
    excluded: Object.fromEntries(exclusions.filter((key) => (c.excluded[key] ?? 0) > 0).map((key) => [key, c.excluded[key]])),
  } };
}

export function percentageFromCounters(c: Record<string, number>, prefix: string): StatsPercentage {
  const get = (key: string) => c[`${prefix}${key}`] ?? 0;
  const numerator = get("Earned"), denominator = get("Available");
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null, coverage: {
    eligibleQuestionTeams: get("EligibleQuestionTeams"), totalQuestionTeams: get("TotalQuestionTeams"),
    eligibleQuestions: get("EligibleQuestions"), totalQuestions: get("TotalQuestions"), eligibleTeams: get("EligibleTeams"), totalTeams: get("TotalTeams"),
    eligibleGames: get("EligibleGames"), totalGames: get("TotalGames"), provisionalGames: get("ProvisionalGames"),
    excluded: Object.fromEntries(exclusions.filter((key) => get(`Excluded:${key}`) > 0).map((key) => [key, get(`Excluded:${key}`)])),
  } };
}

export function publicMetrics(raw: StatsGameMetrics): StatsGameMetrics {
  return { results: raw.results.map(({ id, name, score, outcome, rank }) => ({ id, name, score, outcome, rank })),
    percentage: publicPercentage(raw.percentage), poolPercentage: publicPercentage(raw.poolPercentage), difficulty: publicPercentage(raw.difficulty),
    rounds: raw.rounds.map((round) => ({ id: round.id, title: round.title, type: round.type, closestPool: round.closestPool,
      teams: Object.fromEntries(Object.entries(round.teams).map(([id, team]) => [id, { score: team.score, percentage: publicPercentage(team.percentage),
        reconciliation: { status: team.reconciliation.status, difference: team.reconciliation.difference },
        answers: { recorded: team.answers.recorded, unanswered: team.answers.unanswered, knownCorrectness: team.answers.knownCorrectness, incorrect: team.answers.incorrect, total: team.answers.total } }])) })),
    warnings: raw.warnings.map(({ code, roundId, questionId, teamId, difference }) => ({ code,
      ...(roundId === undefined ? {} : { roundId }), ...(questionId === undefined ? {} : { questionId }),
      ...(teamId === undefined ? {} : { teamId }), ...(difference === undefined ? {} : { difference }) })),
    comparisons: { closestRounds: [...raw.comparisons.closestRounds],
      largestSwings: raw.comparisons.largestSwings.map(({ roundId, teams, change }) => ({ roundId, teams: [...teams] as [string, string], change })),
      highestRoundTeams: raw.comparisons.highestRoundTeams.map(({ roundId, teamId, score }) => ({ roundId, teamId, score })),
      lowestRoundTeams: raw.comparisons.lowestRoundTeams.map(({ roundId, teamId, score }) => ({ roundId, teamId, score })) } };
}

export function publicQuestion(raw: StatsQuestion): StatsQuestion {
  const stages = (values: StatsQuestion["prompt"]) => values.map(({ text, assetId }) => ({ text, assetId }));
  return { id: raw.id, order: raw.order, prompt: stages(raw.prompt), acceptedAnswer: stages(raw.acceptedAnswer), answerHint: raw.answerHint,
    color: raw.color ? { initialColor: raw.color.initialColor, targetColor: raw.color.targetColor, maskAssetId: raw.color.maskAssetId,
      regionIds: raw.color.regionIds ? [...raw.color.regionIds] : null } : null,
    answers: Object.fromEntries(Object.entries(raw.answers).map(([id, answer]) => [id, { answer: answer.answer,
      attempts: answer.attempts.map(({ answer, step }) => ({ answer, step })), correctness: answer.correctness,
      awardedPoints: answer.awardedPoints, perceptionScore: answer.perceptionScore, assetId: answer.assetId }])) };
}
