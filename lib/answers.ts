export const MAX_ANSWER_LENGTH = 10000;

export type AnswerAttempt = {
  answer: string;
  step: number;
  submittedAt: unknown;
  submittedBy: string | null;
};

export type TeamAnswer = {
  wagered?: boolean;
  answer: string;
  locked: boolean;
  user: string | null;
  attempts: AnswerAttempt[];
};

export type AnswerMutation =
  | { answer: string; locked?: never; wagered?: never }
  | { locked: boolean; answer?: never; wagered?: never }
  | { wagered: boolean; answer?: never; locked?: never };

export function parseAttempts(raw: unknown): AnswerAttempt[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("Invalid answer history.");
  let previousStep = -1;
  return raw.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid answer attempt.");
    const attempt = value as Record<string, unknown>;
    if (typeof attempt.answer !== "string" || !attempt.answer.trim() ||
        typeof attempt.step !== "number" || !Number.isInteger(attempt.step) || attempt.step <= previousStep ||
        (attempt.submittedBy !== null && typeof attempt.submittedBy !== "string")) {
      throw new Error("Invalid answer attempt.");
    }
    previousStep = attempt.step;
    return { answer: attempt.answer.trim(), step: attempt.step,
      submittedAt: attempt.submittedAt ?? null, submittedBy: attempt.submittedBy };
  });
}

export function parseTeamAnswer(data: Record<string, unknown>): TeamAnswer {
  if (typeof data.answer !== "string" || typeof data.locked !== "boolean" ||
      (data.user !== null && typeof data.user !== "string")) throw new Error("Invalid team answer.");
  if (data.wagered !== undefined && typeof data.wagered !== "boolean") throw new Error("Invalid wager.");
  return { ...(data.wagered === undefined ? {} : { wagered: data.wagered }), answer: data.answer, locked: data.locked, user: data.user, attempts: parseAttempts(data.attempts) };
}

export function latestAttempt(attempts: AnswerAttempt[]): AnswerAttempt | undefined {
  return attempts[attempts.length - 1];
}

export function isAnswerCommitted(allowAnswerChanges: boolean, attempts: AnswerAttempt[]): boolean {
  return !allowAnswerChanges && attempts.length > 0;
}

export function recordedAnswer(data: Record<string, unknown>, roundType: string): { answer: string; step: number | null } {
  if (roundType === "multi-step") {
    const latest = latestAttempt(parseAttempts(data.attempts));
    return { answer: latest?.answer ?? "", step: latest?.step ?? null };
  }
  return { answer: typeof data.answer === "string" ? data.answer : "", step: null };
}
