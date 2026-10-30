import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { StatsMapping, StatsReview, StatsSnapshot } from "@/types/stats";
import { StatsError } from "./error";
import { canonicalPlayerMappings, inferQuestionMaximum } from "./metrics";
import { completionTime, statsId, statsPaths, type StatsGameRecord } from "./model";
import type { CreateStatsPerson } from "./people";
import { stableJson } from "@/lib/stats/value";

export type ReviewPatch = {
  expectedVersion: number;
  mappings?: Record<string, StatsMapping>;
  hostPersonId?: string | null;
  maxima?: Array<{ roundId: string; questionId: string; points: number | null }>;
  completedAt?: string | null;
  packLabel?: string | null;
  createPeople?: CreateStatsPerson[];
  confirmedImpact?: boolean;
};

export const questionOverrideId = (roundId: string, questionId: string) => createHash("sha256").update(JSON.stringify([roundId, questionId])).digest("hex");

export async function loadReview(tx: Transaction, db: Firestore, gameId: string, game: StatsGameRecord): Promise<StatsReview> {
  const ref = db.doc(statsPaths.game(gameId));
  const [mappings, maxima] = await Promise.all([tx.get(ref.collection("mappings")), tx.get(ref.collection("questionOverrides"))]);
  const overrides: StatsReview["maxima"] = {};
  maxima.docs.forEach((document) => {
    const { roundId, questionId, points } = document.data();
    if (!Object.hasOwn(overrides, roundId)) overrides[roundId] = {};
    overrides[roundId][questionId] = points;
  });
  return { ...game.review, mappings: Object.fromEntries(mappings.docs.filter((document) => document.data().personId !== null).map((document) => [document.id,
    { personId: document.data().personId ?? null, duplicateOf: document.data().duplicateOf ?? null }])), maxima: overrides };
}

export function patchReview(snapshot: StatsSnapshot, previous: StatsReview, patch: ReviewPatch): StatsReview {
  const next: StatsReview = structuredClone(previous);
  if (patch.mappings !== undefined) {
    if (!patch.mappings || typeof patch.mappings !== "object" || Array.isArray(patch.mappings)) throw new StatsError("invalid-mapping", "Mappings must be keyed by appearance ID.", 400);
    for (const [id, mapping] of Object.entries(patch.mappings)) {
      if (!snapshot.appearances.some((appearance) => appearance.id === id)) throw new StatsError("appearance-not-found", "Mapping references an unavailable appearance.", 422);
      if (!mapping || typeof mapping !== "object" || Object.keys(mapping).some((key) => !["personId", "duplicateOf"].includes(key)) ||
          !(mapping.personId === null || (typeof mapping.personId === "string" && mapping.personId)) ||
          !(mapping.duplicateOf === null || (typeof mapping.duplicateOf === "string" && mapping.duplicateOf))) throw new StatsError("invalid-mapping", "Each mapping requires personId and duplicateOf.", 400);
      if (mapping.personId !== null) {
        try { statsId(mapping.personId); }
        catch { throw new StatsError("invalid-mapping", "Invalid mapped person ID.", 400); }
      }
      if (mapping.personId === null && mapping.duplicateOf === null) delete next.mappings[id];
      else next.mappings[id] = { personId: mapping.personId, duplicateOf: mapping.duplicateOf };
    }
  }
  if (Object.hasOwn(patch, "hostPersonId")) {
    if (!(patch.hostPersonId === null || (typeof patch.hostPersonId === "string" && patch.hostPersonId))) throw new StatsError("invalid-host", "A host person ID or null is required.", 400);
    if (patch.hostPersonId && !snapshot.host) throw new StatsError("host-unavailable", "No source host is available for mapping.", 422);
    if (patch.hostPersonId !== null) {
      try { statsId(patch.hostPersonId!); }
      catch { throw new StatsError("invalid-host", "Invalid host person ID.", 400); }
    }
    next.hostPersonId = patch.hostPersonId!;
  }
  if (patch.maxima !== undefined) {
    if (!Array.isArray(patch.maxima)) throw new StatsError("invalid-maxima", "Maximum edits must be an array.", 400);
    const seen = new Set<string>();
    for (const override of patch.maxima) {
      if (!override || typeof override !== "object" || Array.isArray(override) || Object.keys(override).some((key) => !["roundId", "questionId", "points"].includes(key))) throw new StatsError("invalid-maximum", "Invalid question maximum edit.", 400);
      const round = snapshot.rounds.find((round) => round.id === override.roundId);
      if (!round || !round.questions.some((question) => question.id === override.questionId)) throw new StatsError("question-not-found", "Maximum edit references an unavailable question.", 422);
      const id = questionOverrideId(override.roundId, override.questionId);
      if (seen.has(id)) throw new StatsError("duplicate-maximum", "Only one maximum edit per question is allowed.", 400);
      seen.add(id);
      if (!Object.hasOwn(next.maxima, round.id)) next.maxima[round.id] = {};
      if (override.points === null) delete next.maxima[round.id][override.questionId];
      else {
        if (typeof override.points !== "number" || !Number.isFinite(override.points) || override.points < 0) throw new StatsError("invalid-maximum", "Maximum points must be finite and nonnegative.", 400);
        inferQuestionMaximum(round.scoring, override.points);
        next.maxima[round.id][override.questionId] = override.points;
      }
      if (!Object.keys(next.maxima[round.id]).length) delete next.maxima[round.id];
    }
  }
  if (Object.hasOwn(patch, "completedAt")) {
    try { completionTime(patch.completedAt!); }
    catch { throw new StatsError("invalid-completion-date", "Use a canonical UTC timestamp or null for an unknown completion date.", 400); }
    next.completedAt = patch.completedAt!;
  }
  if (Object.hasOwn(patch, "packLabel")) {
    if (!(patch.packLabel === null || (typeof patch.packLabel === "string" && patch.packLabel.trim() && patch.packLabel.length <= 200))) throw new StatsError("invalid-pack-label", "Use a nonempty pack label of at most 200 characters, or null.", 400);
    next.packLabel = patch.packLabel === null ? null : patch.packLabel!.trim();
  }
  try { canonicalPlayerMappings(snapshot.appearances, next.mappings); }
  catch (error) { throw new StatsError("invalid-mapping", error instanceof Error ? error.message : "Invalid person mapping.", 422); }
  return next;
}

export function sameReview(a: StatsReview, b: StatsReview): boolean {
  return stableJson(a) === stableJson(b);
}

export function mappingCounts(review: StatsReview): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of [review.hostPersonId, ...Object.values(review.mappings).map((mapping) => mapping.personId)]) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
