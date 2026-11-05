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
  type: "text" | "image" | "multi-step" | "color" | "sorting";
  questions: HostRoundQuestion[];
  gradingRequired?: boolean;
};

export function resolveHostRoundId(
  rounds: HostRound[],
  selectedRoundId: string | null
): string | null {
  if (selectedRoundId && rounds.some((round) => round.id === selectedRoundId)) {
    return selectedRoundId;
  }

  const activeRoundId = rounds.find((round) => round.state === "active")?.id ?? null;
  if (activeRoundId) {
    return activeRoundId;
  }

  return rounds[0]?.id ?? null;
}

export function getVisibleHostQuestions(round: HostRound): HostRoundQuestion[] {
  if (round.type !== "text") {
    return round.questions;
  }

  return round.questions.filter((question) => question.answer.trim().length > 0);
}

export function hasActiveForegroundRound(rounds: Pick<HostRound, "type" | "state">[]): boolean {
  return rounds.some((round) => round.state === "active" && round.type !== "sorting");
}
