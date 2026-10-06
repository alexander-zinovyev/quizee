import { getAwardedPoints } from "@/lib/components/room/grading";
import { parseAttempts } from "@/lib/answers";

export function parseDraftPoints(value: string, roundType: string): number | null {
  if (!value.trim()) return null;
  const points = Number(value);
  return Number.isFinite(points) ? getAwardedPoints(points, roundType) : null;
}

export type BreakdownAttempt = {
  answer: string;
  step: number;
};

export function parseBreakdownAttempts(attemptsRaw: unknown): BreakdownAttempt[] {
  return parseAttempts(attemptsRaw).map(({ answer, step }) => ({ answer, step }));
}
