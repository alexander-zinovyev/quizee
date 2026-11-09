import { parseQuizStage, type QuizStage, type QuizAnswer } from "./quiz-stage";

export const DEFAULT_STARTING_COINS = 16;
export type Clue = { id: string; category: string; price: number; content: QuizStage };
export type CluesQuestion = { generalClue: QuizStage; answer: QuizAnswer; clues: Clue[] };
export type CluesPackRound = { type: "clues"; title: string; startingCoins: number; questions: CluesQuestion[] };
export type ClueMetadata = Pick<Clue, "id" | "category" | "price">;
export type VisibleClue = ClueMetadata & { content?: { text?: string; media?: { filename: string } }; purchased: boolean };
export type CluesView = { teamId: string | null; remainingCoins: number; clues: VisibleClue[] };
export const CLUE_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
export function cluesStages(round: CluesPackRound): QuizStage[] {
  return round.questions.flatMap((question) => [question.generalClue, ...question.answer.stages, ...question.clues.map((clue) => clue.content)]);
}

function object(raw: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !fields.includes(key))) throw new Error(`Invalid ${label}.`);
  return raw as Record<string, unknown>;
}
function text(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label} must contain text.`);
  return raw.trim();
}
export function positiveCoins(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) <= 0) throw new Error("Coins must be positive whole numbers within the safe integer range.");
  return raw as number;
}
export function parseCluesRound(raw: unknown): CluesPackRound {
  const round = object(raw, ["type", "title", "startingCoins", "questions"], "clues round");
  if (round.type !== "clues") throw new Error("Expected a clues round.");
  if (!Array.isArray(round.questions) || !round.questions.length) throw new Error("Clues rounds need at least one question.");
  return { type: "clues", title: text(round.title, "Round title"), startingCoins: positiveCoins(round.startingCoins),
    questions: round.questions.map((rawQuestion) => {
      const question = object(rawQuestion, ["generalClue", "answer", "clues"], "clues question");
      if (!Array.isArray(question.clues) || !question.clues.length) throw new Error("Questions need at least one clue.");
      const clues = question.clues.map((rawClue): Clue => {
        const clue = object(rawClue, ["id", "category", "price", "content"], "clue");
        if (typeof clue.id !== "string" || !CLUE_ID.test(clue.id)) throw new Error("Invalid clue ID.");
        return { id: clue.id, category: text(clue.category, "Clue category"), price: positiveCoins(clue.price), content: parseQuizStage(clue.content) };
      });
      if (new Set(clues.map((clue) => clue.id)).size !== clues.length) throw new Error("Clue IDs must be unique within a question.");
      const answer = object(question.answer, ["hint", "stages"], "answer");
      if (!Array.isArray(answer.stages) || !answer.stages.length) throw new Error("Answer needs at least one stage.");
      return { generalClue: parseQuizStage(question.generalClue), answer: { hint: text(answer.hint, "Answer hint"), stages: answer.stages.map(parseQuizStage) }, clues };
    }) };
}

export function clueKey(questionId: string, clueId: string): string { return `${questionId}:${clueId}`; }
export function parseRevealedClues(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string" && CLUE_ID.test(id)) || new Set(raw).size !== raw.length) throw new Error("Invalid revealed clues.");
  return [...raw];
}
