import { SORTING_ITEM_ID } from "@/types/sorting";

type SortingQuestionDocument = { id: string; data: () => unknown };

/** Stored sorting questions use the same flat Stage shape as imported questions. */
export function sortingQuestionIds(documents: readonly SortingQuestionDocument[]): string[] {
  if (documents.length < 2) throw new Error("Sorting requires at least two questions.");
  const ids = documents.map((document) => {
    const raw = document.data();
    if (!SORTING_ITEM_ID.test(document.id) || document.id.length > 1500 || /^__.*__$/.test(document.id) ||
        !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid sorting question.");
    const question = raw as Record<string, unknown>;
    if (Object.keys(question).some((key) => !["text", "media"].includes(key))) throw new Error("Sorting questions must be flat Stage objects.");
    if (question.text !== undefined && question.text !== null &&
        (typeof question.text !== "string" || !question.text.trim())) throw new Error("Invalid sorting question text.");
    if (question.media !== undefined && question.media !== null &&
        (typeof question.media !== "object" || Array.isArray(question.media) ||
          typeof (question.media as { storagePath?: unknown }).storagePath !== "string" ||
          !(question.media as { storagePath: string }).storagePath.trim())) throw new Error("Invalid sorting question media.");
    if (!question.text && !question.media) throw new Error("Sorting questions need text or media.");
    return document.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error("Sorting question IDs must be unique.");
  return ids;
}
