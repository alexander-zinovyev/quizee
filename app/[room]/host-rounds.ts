import type { ImageItem, SortingQuestion } from "@/types/quiz";
import { parseSortingOrder } from "@/types/sorting";

export type HostRoundQuestion = {
  id: string;
  prompt: string;
  answer: string;
  order: number;
};

export type HostRound = {
  id: string;
  title: string;
  roundNumber: number;
  order: number;
  state: "scheduled" | "active" | "closed";
  type: "text" | "image" | "multi-step" | "color" | "sorting" | "clues";
  questions: HostRoundQuestion[];
  gradingRequired?: boolean;
  criterion?: string;
  images?: ImageItem[];
  sortingQuestions?: SortingQuestion[];
  questionsLoaded?: boolean;
  correctOrder?: string[];
};

export function getVisibleHostQuestions(round: HostRound): HostRoundQuestion[] {
  if (round.type === "sorting") return [];
  return round.questions;
}

export function getHostSortingView(round: HostRound): { items: SortingQuestion[]; order: string[] } | null {
  const items = round.sortingQuestions ?? round.questions.map((question) => ({ id: question.id, text: question.prompt }));
  const questionsLoaded = round.questionsLoaded ?? items.length >= 2;
  if (!questionsLoaded || round.correctOrder === undefined) return null;
  if (items.length < 2) throw new Error("Sorting rounds need at least two questions.");
  return { items, order: parseSortingOrder(round.correctOrder, items.map((question) => question.id)) };
}

export function hasActiveForegroundRound(rounds: Pick<HostRound, "type" | "state">[]): boolean {
  return rounds.some((round) => round.state === "active" && round.type !== "sorting");
}
