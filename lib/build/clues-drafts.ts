import type { BuildRound } from "@/lib/components/build/round-builder-panel";
import type { BuildCluesQuestion } from "@/lib/components/build/clues-round-editor";

/** Convert saved drafts from the original clues editor without retaining its old pack schema. */
export function upgradeCluesDrafts(rounds: BuildRound[]): BuildRound[] {
  return rounds.map((round) => {
    if (round.type !== "clues") return round;
    return { ...round, cluesQuestions: (round.cluesQuestions ?? []).map((question): BuildCluesQuestion => {
      if (question.generalClue) return question;
      const previous = question as unknown as { id: string; prompt: string; answer: string; clues: Array<{ id: string; category: string; price: number; text: string; image?: string }> };
      if (typeof previous.id !== "string" || typeof previous.prompt !== "string" || typeof previous.answer !== "string" || !Array.isArray(previous.clues)) throw new Error("Unsupported saved clues question.");
      return {
        id: previous.id, collapsed: false,
        generalClue: { id: `${previous.id}-general`, collapsed: false, text: previous.prompt, mediaPath: null },
        answerHint: previous.answer,
        answerStages: [{ id: `${previous.id}-answer`, collapsed: false, text: previous.answer, mediaPath: null }],
        clues: previous.clues.map((clue) => {
          if (typeof clue.id !== "string" || typeof clue.text !== "string" || typeof clue.category !== "string" || typeof clue.price !== "number" ||
              (clue.image !== undefined && typeof clue.image !== "string")) throw new Error("Unsupported saved paid clue.");
          return { id: clue.id, category: clue.category, price: clue.price,
            content: { id: `${clue.id}-content`, collapsed: false, text: clue.text, mediaPath: clue.image ?? null } };
        }),
      };
    }) };
  });
}
