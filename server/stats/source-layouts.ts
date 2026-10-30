import type { StatsRoundScoring } from "@/types/stats";
import { StatsError } from "./error";
import { reconcileScore } from "./metrics";
import type { SourceDocument, SourceRound } from "./source";

/** Image rounds originally kept scored prompts separately from their image choices. */
export function sourceQuestions(round: SourceRound): SourceDocument[] {
  if (!round.prompts?.length) return round.questions;
  if (round.data.type !== "image" || round.questions.length) {
    throw new StatsError("malformed-source", `Ambiguous question collections in round ${round.id}.`, 422);
  }
  return round.prompts;
}

/**
 * The pre-stages grader stored boolean correctness and summed correct answers.
 * Recognize that layout explicitly and require a complete, finalized team-round
 * whose one-point awards reconcile. Modern or mixed awards never use this path.
 */
export function legacyOnePointAwards(round: SourceRound, questions: SourceDocument[], scoring: StatsRoundScoring,
  teamId: string, score: number | null, questionCount: number | null): Map<string, number> {
  const unavailable = new Map<string, number>();
  if (!(scoring.type === "image" || (scoring.type === "text" && scoring.allowWager === false)) ||
      !questions.length || !questions.every(({ data }) => Object.hasOwn(data, "prompt") &&
        (data.prompt === null || typeof data.prompt === "string") && data.stages === undefined && data.text === undefined) ||
      round.data.gradingRequired !== false || round.teamAnswers[teamId]?.metadata?.graded !== true ||
      (scoring.type === "text" && questionCount !== questions.length)) return unavailable;
  const ids = new Set(questions.map(({ id }) => id));
  const frozen = round.teamAnswers[teamId].answers;
  if (round.answers.length !== ids.size || round.answers.some(({ id }) => !ids.has(id)) ||
      frozen.length !== ids.size || frozen.some(({ id, data }) => !ids.has(id) ||
        Object.hasOwn(data, "awardedPoints") || typeof data.correct !== "boolean" || typeof data.answer !== "string")) return unavailable;
  if (scoring.type === "image" && frozen.some(({ id, data }) => {
    const accepted = round.answers.find((answer) => answer.id === id)?.data.answer;
    return typeof accepted !== "string" || !round.images.some((image) => image.id === accepted) || data.correct !== (data.answer === accepted);
  })) return unavailable;
  const awards = new Map(frozen.map(({ id, data }) => [id, data.correct === true ? 1 : 0]));
  return reconcileScore(score, [...awards.values()]).status === "reconciled" ? awards : unavailable;
}
