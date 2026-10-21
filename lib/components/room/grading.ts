export type AwardShortcutSource = {
  step?: number | null;
  wagered?: boolean;
};

export function canRetryAutoGrade(round: { id: string; type: string; state: string; gradingRequired?: boolean }, failedRoundId: string | null): boolean {
  return round.type === "color" && round.state === "closed" && round.gradingRequired === true && failedRoundId === round.id;
}

export type ScoringRound = { type: string; allowWager?: boolean; pointsPerStep?: number[] };

export function allowsNegativePoints(round: ScoringRound): boolean {
  return round.type === "multi-step" || (round.type === "text" && round.allowWager === true);
}

export function getIncorrectAwardShortcut(source: AwardShortcutSource, round: ScoringRound): number {
  return round.type === "text" && round.allowWager && source.wagered ? -2 : 0;
}

export function getAwardShortcut(source: AwardShortcutSource, round: ScoringRound): number {
  if (round.type !== "multi-step") return round.type === "text" && round.allowWager && source.wagered ? 2 : 1;
  if (source.step === null || source.step === undefined) return 0;
  if (!Number.isInteger(source.step) || source.step < 0) throw new Error("Invalid submission step.");
  const points = round.pointsPerStep?.[source.step];
  if (typeof points !== "number" || !Number.isFinite(points)) throw new Error("Invalid points per step.");
  return points;
}

export function getAwardedPoints(points: number, round: ScoringRound): number {
  if (!Number.isFinite(points)) throw new Error("Awarded points must be a finite number.");
  return allowsNegativePoints(round) ? points : Math.max(0, points);
}
