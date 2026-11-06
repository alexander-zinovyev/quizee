import { MAX_ANSWER_LENGTH } from "@/lib/answers";

export type SortingStage = { text?: string; media?: string };
export type SortingQuestion<TStage = SortingStage> = { id: string } & TStage;
export type SortingPackRound = {
  type: "sorting";
  title: string;
  criterion: string;
  questions: SortingQuestion[];
  correctOrder: string[];
};

export type SortingEdit = { id: string; itemId: string; anchorId: string; placement: "before" | "after" };
export type SortingSnapshot = { order: string[]; revision: number };

export const SORTING_ITEM_ID = /^(?!__.*__$)[A-Za-z0-9_-]+$/;
const MEDIA_PATH = /^(?!\/)(?!media\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[:\\\x00-\x1f]).+\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|ogg|m4a|aac|mp4|mov|webm)$/;

function object(raw: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !fields.includes(key))) {
    throw new Error(`Invalid ${label}.`);
  }
  return raw as Record<string, unknown>;
}

function text(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label} must contain text.`);
  return raw.trim();
}

export function parseSortingOrder(raw: unknown, itemIds: readonly string[]): string[] {
  if (!Array.isArray(raw) || raw.length !== itemIds.length ||
      !raw.every((id) => typeof id === "string" && itemIds.includes(id)) || new Set(raw).size !== raw.length) {
    throw new Error("Sorting order must contain every item ID exactly once.");
  }
  return [...raw];
}

export function parseSortingRound(raw: unknown): SortingPackRound {
  const round = object(raw, ["type", "title", "criterion", "questions", "correctOrder"], "sorting round");
  if (round.type !== "sorting") throw new Error("Expected a sorting round.");
  const title = text(round.title, "Sorting title");
  const criterion = text(round.criterion, "Sorting criterion");
  if (!Array.isArray(round.questions) || round.questions.length < 2) throw new Error("Sorting rounds need at least two questions.");
  const questions = round.questions.map((rawQuestion): SortingQuestion => {
    const question = object(rawQuestion, ["id", "text", "media"], "sorting question");
    if (typeof question.id !== "string" || question.id.length > 1500 || !SORTING_ITEM_ID.test(question.id)) throw new Error("Sorting question IDs must use letters, numbers, underscores, or dashes and fit within 1500 characters.");
    const result: SortingQuestion = { id: question.id };
    if (question.text !== undefined) result.text = text(question.text, "Sorting question text");
    if (question.media !== undefined) {
      if (typeof question.media !== "string" || !MEDIA_PATH.test(question.media)) throw new Error("Sorting media must be a relative media path with a supported extension.");
      result.media = question.media;
    }
    if (!result.text && !result.media) throw new Error("Sorting questions need text or media.");
    return result;
  });
  const questionIds = questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) throw new Error("Sorting question IDs must be unique.");
  const correctOrder = parseSortingOrder(round.correctOrder, questionIds);
  if (JSON.stringify(correctOrder).length > MAX_ANSWER_LENGTH) throw new Error(`Sorting order must fit within the ${MAX_ANSWER_LENGTH}-character answer limit.`);
  return { type: "sorting", title, criterion, questions, correctOrder };
}

export function parseSortingEdit(raw: unknown): SortingEdit {
  const edit = object(raw, ["id", "itemId", "anchorId", "placement"], "sorting edit");
  if (typeof edit.id !== "string" || !/^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/.test(edit.id) ||
      typeof edit.itemId !== "string" || !SORTING_ITEM_ID.test(edit.itemId) ||
      typeof edit.anchorId !== "string" || !SORTING_ITEM_ID.test(edit.anchorId) || edit.itemId === edit.anchorId ||
      (edit.placement !== "before" && edit.placement !== "after")) throw new Error("Invalid sorting edit.");
  return { id: edit.id, itemId: edit.itemId, anchorId: edit.anchorId, placement: edit.placement };
}

export function parseSortingSnapshot(raw: unknown, itemIds: readonly string[]): SortingSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid sorting snapshot.");
  const snapshot = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0 || itemIds.length < 2) throw new Error("Invalid sorting revision.");
  return { order: parseSortingOrder(snapshot.order, itemIds), revision: snapshot.revision as number };
}

export function applySortingEdit(order: readonly string[], rawEdit: SortingEdit): string[] {
  const edit = parseSortingEdit(rawEdit);
  if (!order.includes(edit.itemId) || !order.includes(edit.anchorId)) throw new Error("Sorting edit references an unknown item.");
  const next = parseSortingOrder(order, order).filter((id) => id !== edit.itemId);
  const anchorIndex = next.indexOf(edit.anchorId);
  next.splice(anchorIndex + Number(edit.placement === "after"), 0, edit.itemId);
  return next;
}
