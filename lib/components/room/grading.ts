export type AwardShortcutSource = {
  step?: number | null;
};

export function getAwardShortcut(source: AwardShortcutSource, round: { type: string; pointsPerStep?: number[] }): number {
  if (round.type !== "multi-step") return 1;
  if (source.step === null || source.step === undefined) return 0;
  if (!Number.isInteger(source.step) || source.step < 0) throw new Error("Invalid submission step.");
  const points = round.pointsPerStep?.[source.step];
  if (typeof points !== "number" || !Number.isFinite(points)) throw new Error("Invalid points per step.");
  return points;
}

export function getAwardedPoints(points: number, roundType: string): number {
  if (!Number.isFinite(points)) throw new Error("Awarded points must be a finite number.");
  return roundType === "multi-step" ? points : Math.max(0, points);
}
