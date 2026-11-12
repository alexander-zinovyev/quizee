import { parseQuizStage, type QuizStage, type QuizAnswer } from "./quiz-stage";

export const DEFAULT_STARTING_COINS = 16;
export type CluePricing = { mode: "manual" } | { mode: "arithmetic" | "geometric"; basePrice: number; progression: number };
export type Clue = { id: string; category: string; price?: number; content: QuizStage };
export type CluesQuestion = { generalClue: QuizStage; answer: QuizAnswer; clues: Clue[] };
export type CluesPackRound = { type: "clues"; title: string; startingCoins: number; pricing?: CluePricing; questions: CluesQuestion[] };
export type ClueMetadata = Pick<Clue, "id" | "category" | "price">;
export type StoredClueStage = { text?: string | null; media?: { storagePath: string; filename: string; contentType?: string | null } | null };
export type VisibleClue = ClueMetadata & { price: number; content?: { text?: string; media?: { filename: string; storagePath: string } }; purchased: boolean };
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
export function parseCluePricing(raw: unknown): CluePricing {
  if (raw === undefined) return { mode: "manual" };
  const pricing = object(raw, ["mode", "basePrice", "progression"], "clue pricing");
  if (pricing.mode === "manual") {
    object(raw, ["mode"], "manual clue pricing");
    return { mode: "manual" };
  }
  if (pricing.mode !== "arithmetic" && pricing.mode !== "geometric") throw new Error("Invalid clue pricing mode.");
  return { mode: pricing.mode,
    basePrice: positiveCoins(pricing.basePrice === undefined ? 1 : pricing.basePrice),
    progression: positiveCoins(pricing.progression === undefined ? (pricing.mode === "arithmetic" ? 1 : 2) : pricing.progression) };
}

/** Count only this team's purchases on this question, regardless of clue order. */
export function cluePrice(pricing: CluePricing, clue: Pick<Clue, "price">, purchasedCount: number): number {
  if (!Number.isSafeInteger(purchasedCount) || purchasedCount < 0) throw new Error("Invalid purchased clue count.");
  if (pricing.mode === "manual") return positiveCoins(clue.price);
  const price = pricing.mode === "arithmetic"
    ? pricing.basePrice + purchasedCount * pricing.progression
    : pricing.basePrice * pricing.progression ** purchasedCount;
  if (!Number.isSafeInteger(price) || price <= 0) throw new Error("Clue prices must stay within the positive safe integer range.");
  return price;
}
export function parsePurchasedClueCounts(raw: unknown): Record<string, number> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.values(raw).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Invalid purchased clue counts.");
  }
  return { ...raw } as Record<string, number>;
}
export function remainingCoins(raw: unknown, startingCoins: number): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > positiveCoins(startingCoins)) throw new Error("Invalid stored coin balance.");
  return raw as number;
}

export function parseClueContent(raw: unknown): NonNullable<VisibleClue["content"]> {
  if (!raw || typeof raw !== "object") throw new Error("Missing clue definition stage.");
  const { text, media } = raw as { text?: unknown; media?: { filename?: unknown; storagePath?: unknown } | null };
  if ((text != null && typeof text !== "string") || (media != null && (typeof media !== "object" || typeof media.filename !== "string" || !media.filename || typeof media.storagePath !== "string" || !media.storagePath))) throw new Error("Invalid clue definition stage.");
  if (!text && !media) throw new Error("Missing clue definition stage.");
  return { ...(text ? { text: text as string } : {}), ...(media ? { media: { filename: media.filename as string, storagePath: media.storagePath as string } } : {}) };
}

export function parseCluesRound(raw: unknown): CluesPackRound {
  const round = object(raw, ["type", "title", "startingCoins", "pricing", "questions"], "clues round");
  if (round.type !== "clues") throw new Error("Expected a clues round.");
  if (!Array.isArray(round.questions) || !round.questions.length) throw new Error("Clues rounds need at least one question.");
  const pricing = parseCluePricing(round.pricing);
  return { type: "clues", title: text(round.title, "Round title"), startingCoins: positiveCoins(round.startingCoins),
    ...(round.pricing !== undefined ? { pricing } : {}),
    questions: round.questions.map((rawQuestion) => {
      const question = object(rawQuestion, ["generalClue", "answer", "clues"], "clues question");
      if (!Array.isArray(question.clues) || !question.clues.length) throw new Error("Questions need at least one clue.");
      const clues = question.clues.map((rawClue): Clue => {
        const clue = object(rawClue, ["id", "category", "price", "content"], "clue");
        if (typeof clue.id !== "string" || !CLUE_ID.test(clue.id)) throw new Error("Invalid clue ID.");
        return { id: clue.id, category: text(clue.category, "Clue category"),
          ...(pricing.mode === "manual" || clue.price !== undefined ? { price: positiveCoins(clue.price) } : {}), content: parseQuizStage(clue.content) };
      });
      // Refuse unsafe configurations at import, rather than failing partway through a game.
      if (pricing.mode !== "manual") cluePrice(pricing, {}, clues.length - 1);
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
