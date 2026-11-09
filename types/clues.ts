export type Clue = { id: string; category: string; price: number; text: string; image?: string };
export type CluesQuestion = { prompt: string; answer: string; clues: Clue[] };
export type CluesPackRound = { type: "clues"; title: string; startingCoins: number; questions: CluesQuestion[] };
export type ClueMetadata = Pick<Clue, "id" | "category" | "price">;
export type VisibleClue = ClueMetadata & { text?: string; image?: boolean; purchased: boolean };
export type CluesView = { teamId: string | null; remainingCoins: number; clues: VisibleClue[] };
export const CLUE_ID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
const IMAGE_PATH = /^(?!\/)(?!media\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[:\\\x00-\x1f]).+\.(png|jpg|jpeg|gif|webp|svg)$/;

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
      const question = object(rawQuestion, ["prompt", "answer", "clues"], "clues question");
      if (!Array.isArray(question.clues) || !question.clues.length) throw new Error("Questions need at least one clue.");
      const clues = question.clues.map((rawClue): Clue => {
        const clue = object(rawClue, ["id", "category", "price", "text", "image"], "clue");
        if (typeof clue.id !== "string" || !CLUE_ID.test(clue.id)) throw new Error("Invalid clue ID.");
        if (clue.image !== undefined && (typeof clue.image !== "string" || !IMAGE_PATH.test(clue.image))) throw new Error("Clue images must use relative image paths.");
        return { id: clue.id, category: text(clue.category, "Clue category"), price: positiveCoins(clue.price), text: text(clue.text, "Clue text"),
          ...(clue.image === undefined ? {} : { image: clue.image as string }) };
      });
      if (new Set(clues.map((clue) => clue.id)).size !== clues.length) throw new Error("Clue IDs must be unique within a question.");
      return { prompt: text(question.prompt, "Question prompt"), answer: text(question.answer, "Accepted answer"), clues };
    }) };
}

export function clueKey(questionId: string, clueId: string): string { return `${questionId}:${clueId}`; }
export function parseRevealedClues(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string" && CLUE_ID.test(id)) || new Set(raw).size !== raw.length) throw new Error("Invalid revealed clues.");
  return [...raw];
}
