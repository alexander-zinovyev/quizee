import { isAnswerCommitted, latestAttempt, type TeamAnswer } from "@/lib/answers";

export function parsePointsPerStep(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || !value.every((points) => typeof points === "number" && Number.isFinite(points))) {
    throw new Error("Invalid points per step.");
  }
  return value;
}

export function captureMultiStepAnswer(
  input: TeamAnswer,
  step: number,
  allowAnswerChanges: boolean,
  submittedAt: unknown
): TeamAnswer {
  if (!Number.isInteger(step) || step < 0) throw new Error("Invalid step.");
  const latest = latestAttempt(input.attempts);
  const answer = input.answer.trim();
  if (isAnswerCommitted(allowAnswerChanges, input.attempts) || !answer ||
      answer === latest?.answer || (latest && latest.step >= step)) return input;
  return { ...input, attempts: [...input.attempts,
    { answer, step, submittedAt, submittedBy: input.user }] };
}

export function snapshotTeamAnswer(input: TeamAnswer, roundType: string, allowWager = false): Record<string, unknown> {
  if (roundType !== "text" && roundType !== "multi-step") throw new Error("Unsupported answer type.");
  if (input.wagered && (roundType !== "text" || !allowWager)) throw new Error("Wagers are not enabled for this round.");
  return roundType === "multi-step"
    ? { attempts: input.attempts }
    : { answer: input.answer.trim(), user: input.user,
      ...(input.wagered === undefined ? {} : { wagered: input.wagered }),
      ...(input.wagered ? { awardedPoints: -2 } : {}) };
}
