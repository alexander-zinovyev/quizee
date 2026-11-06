import type { SortingQuestion } from "@/types/quiz";
import { parseSortingOrder } from "@/types/sorting";
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

export type SortingBreakdown = {
  questions: SortingQuestion[];
  order: string[];
  correctOrder: string[] | null;
  pointsByQuestion: Record<string, number>;
};

export function parseBreakdownSortingOrder(raw: unknown, correct: unknown, questions: SortingQuestion[], scored: boolean): SortingBreakdown {
  if (!raw || typeof raw !== "object") throw new Error("Missing sorting submission.");
  const data = raw as Record<string, unknown>;
  const ids = questions.map((question) => question.id);
  const order = parseSortingOrder(data.order, ids);
  const correctOrder = scored ? parseSortingOrder(correct, ids) : null;
  const points = data.pointsByQuestion;
  const pointsByQuestion: Record<string, number> = {};
  if (scored) {
    if (!points || typeof points !== "object" || Array.isArray(points) || Object.keys(points).length !== ids.length) throw new Error("Missing sorting points.");
    for (const id of ids) {
      const value = (points as Record<string, unknown>)[id];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid sorting points.");
      pointsByQuestion[id] = value;
    }
  }
  return { questions, order, correctOrder, pointsByQuestion };
}
