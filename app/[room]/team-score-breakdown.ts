import { getAwardedPoints, type ScoringRound } from "@/lib/components/room/grading";
import { parseAttempts } from "@/lib/answers";

export function parseDraftPoints(value: string, round: ScoringRound): number | null {
  if (!value.trim()) return null;
  const points = Number(value);
  return Number.isFinite(points) ? getAwardedPoints(points, round) : null;
}

export type BreakdownAttempt = {
  answer: string;
  step: number;
};

export function parseBreakdownAttempts(attemptsRaw: unknown): BreakdownAttempt[] {
  return parseAttempts(attemptsRaw).map(({ answer, step }) => ({ answer, step }));
}
