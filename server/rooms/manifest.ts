import { cluesStages, type CluePricing } from "@/types/clues";
import type { ValidatedRound } from "./validation";
import type { ColorScoring } from "@/types/color";

export type RoundDocumentData = {
  type: ValidatedRound["type"];
  title: string;
  order: number;
  state: "scheduled";
  activeWindow: { startedAt: null; endedAt: null };
  questionCount: number;
  gradingRequired: false;
  pointsPerStep?: number[];
  allowAnswerChanges?: boolean;
  allowWager?: boolean;
  startingCoins?: number;
  pricing?: CluePricing;
  scoring?: ColorScoring;
  criterion?: string;
};

function addStageMedia(mediaPaths: Set<string>, stages: Array<{ media?: { path: string } }>) {
  stages.forEach((stage) => {
    if (stage.media?.path) {
      mediaPaths.add(stage.media.path);
    }
  });
}

export function collectReferencedMedia(rounds: ValidatedRound[]): Set<string> {
  const referencedMedia = new Set<string>();

  rounds.forEach((round) => {
    if (round.type === "clues") {
      cluesStages(round).forEach((stage) => { if (stage.media) referencedMedia.add(stage.media); });
      return;
    }
    if (round.type === "sorting") {
      addStageMedia(referencedMedia, round.questions);
      return;
    }
    if (round.type === "color") {
      round.questions.forEach((q) => { referencedMedia.add(q.imagePath); if (q.maskPath) referencedMedia.add(q.maskPath); });
      return;
    }
    if (round.type === "text") {
      round.questions.forEach((question) => {
        addStageMedia(referencedMedia, question.promptStages);
        addStageMedia(referencedMedia, question.answerStages);
      });
      return;
    }

    if (round.type === "multi-step") {
      round.questions.forEach((question) => {
        addStageMedia(referencedMedia, question.steps);
        addStageMedia(referencedMedia, question.answerStages);
      });
      return;
    }

    round.questions.forEach((question) => {
      if (question.prompt?.media?.path) {
        referencedMedia.add(question.prompt.media.path);
      }
      referencedMedia.add(question.imagePath);
    });
  });

  return referencedMedia;
}

export function createRoundDocumentData(round: ValidatedRound): RoundDocumentData {
  const base: RoundDocumentData = {
    type: round.type,
    title: round.title,
    order: round.order,
    state: "scheduled",
    activeWindow: { startedAt: null, endedAt: null },
    questionCount: round.questions.length,
    gradingRequired: false,
  };

  if (round.type === "clues") return { ...base, startingCoins: round.startingCoins, ...(round.pricing ? { pricing: round.pricing } : {}) };
  if (round.type === "sorting") return { ...base, criterion: round.criterion };
  if (round.type === "text" && round.allowWager !== undefined) return { ...base, allowWager: round.allowWager };
  if (round.type === "color") return { ...base, scoring: round.scoring };
  if (round.type !== "multi-step") {
    return base;
  }

  return {
    ...base,
    pointsPerStep: round.pointsPerStep,
    allowAnswerChanges: round.allowAnswerChanges,
  };
}
