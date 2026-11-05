import { MAX_ANSWER_LENGTH } from "@/lib/answers";

export type SortingStage = { text?: string; media?: string };
export type SortingItem<TStage = SortingStage> = { id: string; stages: TStage[] };
export type SortingPackRound = {
  type: "sorting";
  title: string;
  criterion: string;
  items: SortingItem[];
  correctOrder: string[];
};

export const SORTING_ITEM_ID = /^[A-Za-z0-9_-]+$/;
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
  const round = object(raw, ["type", "title", "criterion", "items", "correctOrder"], "sorting round");
  if (round.type !== "sorting") throw new Error("Expected a sorting round.");
  const title = text(round.title, "Sorting title");
  const criterion = text(round.criterion, "Sorting criterion");
  if (!Array.isArray(round.items) || round.items.length < 2) throw new Error("Sorting rounds need at least two items.");
  const items = round.items.map((rawItem): SortingItem => {
    const item = object(rawItem, ["id", "stages"], "sorting item");
    if (typeof item.id !== "string" || !SORTING_ITEM_ID.test(item.id)) throw new Error("Sorting item IDs must use letters, numbers, underscores, or dashes.");
    if (!Array.isArray(item.stages) || !item.stages.length) throw new Error("Sorting items need at least one stage.");
    const stages = item.stages.map((rawStage): SortingStage => {
      const stage = object(rawStage, ["text", "media"], "sorting item stage");
      const result: SortingStage = {};
      if (stage.text !== undefined) result.text = text(stage.text, "Sorting item text");
      if (stage.media !== undefined) {
        if (typeof stage.media !== "string" || !MEDIA_PATH.test(stage.media)) throw new Error("Sorting media must be a relative media path with a supported extension.");
        result.media = stage.media;
      }
      if (!result.text && !result.media) throw new Error("Sorting item stages need text or media.");
      return result;
    });
    return { id: item.id, stages };
  });
  const itemIds = items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) throw new Error("Sorting item IDs must be unique.");
  const correctOrder = parseSortingOrder(round.correctOrder, itemIds);
  if (JSON.stringify(correctOrder).length > MAX_ANSWER_LENGTH) throw new Error(`Sorting order must fit within the ${MAX_ANSWER_LENGTH}-character answer limit.`);
  return { type: "sorting", title, criterion, items, correctOrder };
}
