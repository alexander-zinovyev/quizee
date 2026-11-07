import type { RoundMeta } from "./hooks/use-room-rounds";

/** Private answer documents are only consumed by the host round subscriptions. */
export function parseHostRoundAnswers(type: RoundMeta["type"], documents: Array<{ id: string; data: Record<string, unknown> }>) {
  const answers: Record<string, string> = {};
  const hints: Record<string, string> = {};
  let correctOrder: string[] | null = null;
  if (type === "sorting") {
    const value = documents.find((document) => document.id === "order")?.data.correctOrder;
    if (!Array.isArray(value) || value.length < 2 || !value.every((id) => typeof id === "string" && id.length > 0) || new Set(value).size !== value.length) {
      throw new Error("Invalid correct sorting order.");
    }
    correctOrder = [...value];
  } else {
    for (const { id, data } of documents) {
      const hint = typeof data.hint === "string" ? data.hint.trim() : "";
      hints[id] = hint;
      const stageText = Array.isArray(data.stages) ? data.stages
        .map((stage) => typeof stage?.text === "string" ? stage.text.trim() : "")
        .find((text) => text.length > 0) : "";
      const raw = type === "image" ? data.answer : hint || stageText || data.answer || data.value || data.correctAnswer;
      answers[id] = typeof raw === "string" ? raw.trim() : "";
    }
  }
  return { answers, hints, correctOrder };
}
