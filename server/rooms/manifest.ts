import type { ValidatedRound } from "./validation";

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

  if (round.type !== "multi-step") {
    return base;
  }

  return {
    ...base,
    pointsPerStep: round.pointsPerStep,
    allowAnswerChanges: round.allowAnswerChanges,
  };
}
