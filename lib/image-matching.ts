export type ImageMatch = { answer: string; locked: boolean };
export type ImageMatches = Record<string, ImageMatch>;
export type ImageMatchEdit =
  | { type: "assign"; questionId: string; imageId: string }
  | { type: "clear"; questionId: string }
  | { type: "lock"; questionId: string; locked: boolean };

export function assertUniqueImageMatches(matches: ImageMatches) {
  const assigned = new Set<string>();
  for (const match of Object.values(matches)) {
    if (!match.answer) continue;
    if (assigned.has(match.answer)) throw new Error("Duplicate saved image assignments. Ask the host to correct this round's responses.");
    assigned.add(match.answer);
  }
}

export function parseImageMatch(data: unknown, imageIds: readonly string[]): ImageMatch {
  if (data === undefined) return { answer: "", locked: false };
  if (!data || typeof data !== "object") throw new Error("Invalid saved image match.");
  const value = data as Record<string, unknown>;
  if (typeof value.answer !== "string" || (value.answer !== "" && !imageIds.includes(value.answer)) ||
      (value.locked !== undefined && typeof value.locked !== "boolean")) {
    throw new Error("Invalid saved image match.");
  }
  return { answer: value.answer, locked: value.locked === true };
}

/** The stored contract remains question ID -> image ID, regardless of drag direction. */
export function editImageMatches(
  current: ImageMatches, edit: ImageMatchEdit, questionIds: readonly string[], imageIds: readonly string[],
): ImageMatches {
  assertUniqueImageMatches(current);
  if (!questionIds.includes(edit.questionId)) throw new Error("Unknown image description.");
  const previous = current[edit.questionId] ?? { answer: "", locked: false };
  const next = { ...current };
  if (edit.type === "lock") {
    next[edit.questionId] = { ...previous, locked: edit.locked };
    return next;
  }
  if (previous.locked) throw new Error("Unlock the match before changing it.");
  if (edit.type === "clear") {
    next[edit.questionId] = { answer: "", locked: false };
    return next;
  }
  if (!imageIds.includes(edit.imageId)) throw new Error("Unknown matching image.");
  for (const [questionId, match] of Object.entries(current)) {
    if (questionId === edit.questionId || match.answer !== edit.imageId) continue;
    if (match.locked) throw new Error("Unlock the destination match before replacing it.");
    next[questionId] = { answer: "", locked: false };
  }
  next[edit.questionId] = { answer: edit.imageId, locked: false };
  return next;
}
