import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { assertStatsAdmin } from "./authorization";
import { applyContributionPlan, planContributionReplacement } from "./contributions";
import { StatsError } from "./error";
import { statsPaths, type StatsGameRecord, type StatsPersonRecord } from "./model";
import { newStatsPerson } from "./people";
import { gameQueueTags, projectGame } from "./projection";
import { loadReview, mappingCounts, patchReview, questionOverrideId, sameReview, type ReviewPatch } from "./reviews";
import { loadSnapshot, prepareSnapshot, saveSnapshot } from "./snapshots";
import { normalizeRoomSource, readEndedRoom } from "./source";
import { stableJson } from "@/lib/stats/value";
import { assertWriteBudget } from "./write-budget";
import { statsOperation } from "./telemetry";

function versionMatches(game: StatsGameRecord, version: number) {
  if (game.version !== version) throw new StatsError("stale-version", "This game review changed. Reload before continuing.", 409);
}

export function changeGameReview(db: Firestore, actorId: string, gameId: string, patch: ReviewPatch) {
  return statsOperation("edit-review", { actorId, gameId }, () => changeGameReviewCommand(db, actorId, gameId, patch));
}

async function changeGameReviewCommand(db: Firestore, actorId: string, gameId: string, patch: ReviewPatch) {
  const ref = db.doc(statsPaths.game(gameId)), audit = db.doc(statsPaths.audit(randomUUID()));
  const creations = new Map<string, StatsPersonRecord>();
  if (patch.createPeople !== undefined) {
    if (!Array.isArray(patch.createPeople)) throw new StatsError("invalid-people", "Person creations must be an array.", 400);
    for (const input of patch.createPeople) {
      const person = newStatsPerson(input, actorId);
      if (creations.has(input.id)) throw new StatsError("duplicate-creation", "Person creation IDs must be distinct.", 400);
      creations.set(input.id, person);
    }
  }
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("game-not-found", "Create an ended-room snapshot before reviewing this game.", 404);
    const game = document.data() as StatsGameRecord;
    const snapshot = await loadSnapshot(tx, db, gameId, game.snapshotId);
    const previous = await loadReview(tx, db, gameId, game), next = patchReview(snapshot, previous, patch);
    const references = mappingCounts(next);
    for (const id of creations.keys()) if (!references.has(id)) throw new StatsError("unlinked-creation", "People created in a review must be linked in that same review.", 422);
    const changed = !sameReview(previous, next);
    if (changed) versionMatches(game, patch.expectedVersion);
    const projection = projectGame(snapshot, next, game.version + (changed ? 1 : 0));
    const plan = await planContributionReplacement(tx, db, gameId, previous, next, game.published, projection, creations);
    const mutations: Array<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData | null }> = [
      { ref, data: { review: { hostPersonId: next.hostPersonId, completedAt: next.completedAt, packLabel: next.packLabel }, summary: projection.summary,
        queueTags: gameQueueTags(snapshot, next, projection.summary, game.published), version: game.version + 1 } },
      ...plan.writes,
    ];
    if (!changed) return { version: game.version, nextVersion: game.version, changed,
      published: game.published, summary: projection.summary, impact: plan.impact, workload: { documents: 0, jsonBytes: 0 } };
    if (game.published && patch.confirmedImpact !== true) throw new StatsError("impact-confirmation-required", "Review and confirm the effect on published statistics before saving.", 422);
    const at = new Date().toISOString();
    for (const id of new Set([...Object.keys(previous.mappings), ...Object.keys(next.mappings)])) {
      if (JSON.stringify(previous.mappings[id]) === JSON.stringify(next.mappings[id])) continue;
      const mapping = ref.collection("mappings").doc(id);
      mutations.push({ ref: mapping, data: next.mappings[id] ? { ...next.mappings[id], needsReview: false } : null });
    }
    for (const roundId of new Set([...Object.keys(previous.maxima), ...Object.keys(next.maxima)])) {
      for (const questionId of new Set([...Object.keys(previous.maxima[roundId] ?? {}), ...Object.keys(next.maxima[roundId] ?? {})])) {
        const before = previous.maxima[roundId]?.[questionId], after = next.maxima[roundId]?.[questionId];
        if (before === after) continue;
        const override = ref.collection("questionOverrides").doc(questionOverrideId(roundId, questionId));
        mutations.push({ ref: override, data: after === undefined ? null : { roundId, questionId, points: after } });
      }
    }
    const changedFields = (["mappings", "maxima", "hostPersonId", "completedAt", "packLabel"] as const).filter((key) => stableJson(previous[key]) !== stableJson(next[key]));
    const mappingChanges = [...new Set([...Object.keys(previous.mappings), ...Object.keys(next.mappings)])].filter((id) => stableJson(previous.mappings[id] ?? null) !== stableJson(next.mappings[id] ?? null))
      .map((appearanceId) => ({ appearanceId, fromPersonId: previous.mappings[appearanceId]?.personId ?? null, toPersonId: next.mappings[appearanceId]?.personId ?? null,
        fromDuplicateOf: previous.mappings[appearanceId]?.duplicateOf ?? null, toDuplicateOf: next.mappings[appearanceId]?.duplicateOf ?? null }));
    const event = { actorId, action: "edit-review", gameId, snapshotId: game.snapshotId, version: game.version + 1, at,
      changedFields, mappingChanges, createdPersonIds: plan.createdPersonIds, questionChanges: patch.maxima?.filter((override) => previous.maxima[override.roundId]?.[override.questionId] !== next.maxima[override.roundId]?.[override.questionId]).map(({ roundId, questionId }) => ({ roundId, questionId })) ?? [] };
    const workload = assertWriteBudget([...mutations, { ref: audit, data: event }]);
    // Root review writes merge with the existing publication/snapshot selection fields.
    for (const mutation of mutations) {
      if (mutation.ref.path === ref.path) tx.update(ref, mutation.data!);
      else if (mutation.data === null) tx.delete(mutation.ref);
      else tx.set(mutation.ref, mutation.data);
    }
    tx.create(audit, event);
    return { version: game.version + 1, nextVersion: game.version + 1, changed: true, published: game.published,
      summary: projection.summary, impact: plan.impact, workload,
      mappingCorrections: game.published ? mappingChanges.length : 0,
      duplicateResolutions: mappingChanges.filter((change) => change.toDuplicateOf !== null && change.toDuplicateOf !== change.fromDuplicateOf).length };
  });
}

export type PublishGameInput = { expectedVersion: number; approvedDigest: string; acknowledgeIncompleteGrading: boolean };

/** Only initial publication reads rooms. Repeated publication returns before touching current source. */
export function publishStatsGame(db: Firestore, actorId: string, gameId: string, input: PublishGameInput) {
  return statsOperation("publish", { actorId, gameId }, () => publishStatsGameCommand(db, actorId, gameId, input));
}

async function publishStatsGameCommand(db: Firestore, actorId: string, gameId: string, input: PublishGameInput) {
  const ref = db.doc(statsPaths.game(gameId));
  const initial = await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("game-not-found", "Create and review a snapshot before publication.", 404);
    const game = document.data() as StatsGameRecord;
    if (game.published) return game;
    versionMatches(game, input.expectedVersion);
    const snapshot = await tx.get(db.doc(statsPaths.snapshot(gameId, game.snapshotId)));
    if (snapshot.data()?.ready !== true || snapshot.data()?.digest !== input.approvedDigest) throw new StatsError("stale-preview", "The approved snapshot is unavailable or no longer selected.", 409);
    if (game.summary.provisional && input.acknowledgeIncompleteGrading !== true) throw new StatsError("grading-acknowledgement-required", "Acknowledge that incomplete grading and its recorded scores will remain frozen.", 422);
    return game;
  }, { readOnly: true });
  if (initial.published) return { version: initial.version, snapshotId: initial.snapshotId, publishedAt: initial.publishedAt, reviewDurationMs: initial.reviewDurationMs ?? null };
  const publicationSnapshot = normalizeRoomSource(await readEndedRoom(db, gameId), randomUUID());
  if (publicationSnapshot.digest !== input.approvedDigest) {
    const refreshed = await prepareSnapshot(db, gameId, actorId, input.expectedVersion);
    throw new StatsError("source-changed", "Room results changed after review. Review the refreshed snapshot before publishing.", 409, refreshed);
  }
  await saveSnapshot(db, publicationSnapshot);
  const audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("game-not-found", "The saved game no longer exists.", 404);
    const current = document.data() as StatsGameRecord;
    if (current.published) return { version: current.version, snapshotId: current.snapshotId, publishedAt: current.publishedAt, reviewDurationMs: current.reviewDurationMs ?? null };
    versionMatches(current, input.expectedVersion);
    if (current.snapshotId !== initial.snapshotId) throw new StatsError("stale-preview", "The selected snapshot changed.", 409);
    const room = await tx.get(db.collection("rooms").doc(gameId));
    if (room.data()?.state !== "ended") throw new StatsError("room-not-ended", "Only a currently ended room can be published.", 422);
    const frozen = await loadSnapshot(tx, db, gameId, publicationSnapshot.id);
    const review = await loadReview(tx, db, gameId, current);
    const projection = projectGame(frozen, review, current.version + 1);
    if (projection.summary.provisional && input.acknowledgeIncompleteGrading !== true) throw new StatsError("grading-acknowledgement-required", "Acknowledge that incomplete grading and its recorded scores will remain frozen.", 422);
    const plan = await planContributionReplacement(tx, db, gameId, review, review, true, projection);
    const publishedAt = new Date().toISOString();
    const reviewDurationMs = current.reviewStartedAt ? Date.parse(publishedAt) - Date.parse(current.reviewStartedAt) : null;
    if (reviewDurationMs !== null && (!Number.isFinite(reviewDurationMs) || reviewDurationMs < 0)) throw new StatsError("review-time-integrity", "The saved review start time is invalid.", 409);
    const update = { published: true, publishedAt, snapshotId: frozen.id, summary: projection.summary,
      queueTags: gameQueueTags(frozen, review, projection.summary, true), version: current.version + 1,
      ...(reviewDurationMs === null ? {} : { reviewDurationMs }) };
    const event = { actorId, action: "publish", gameId, snapshotId: frozen.id, approvedDigest: input.approvedDigest,
      warningAcknowledgements: projection.summary.provisional ? ["grading-incomplete"] : [], reviewDurationMs, version: current.version + 1, at: publishedAt };
    assertWriteBudget([{ ref, data: update }, ...plan.writes, { ref: audit, data: event }]);
    applyContributionPlan(tx, plan); tx.update(ref, update); tx.create(audit, event);
    return { version: current.version + 1, snapshotId: frozen.id, publishedAt, reviewDurationMs };
  });
}
