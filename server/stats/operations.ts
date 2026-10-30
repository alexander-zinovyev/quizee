import { randomUUID } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { stableJson } from "@/lib/stats/value";
import { replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { assertStatsAdmin } from "./authorization";
import { applyContributionPlan, planContributionReplacement } from "./contributions";
import { StatsError } from "./error";
import { RECONCILIATION_TOLERANCE } from "./metrics";
import { completionTime, statsId, statsPaths, STATS_ROOT, type StatsGameRecord, type StatsHostContribution, type StatsPersonRecord, type StatsPlayerContribution } from "./model";
import { gameQueueTags, projectGame } from "./projection";
import { loadReview } from "./reviews";
import { loadSnapshot } from "./snapshots";
import { assertWriteBudget } from "./write-budget";

function pageLimit(value = 25) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new StatsError("invalid-limit", "Page size must be between 1 and 100.", 400);
  return value;
}
function expectedVersion(actual: number, expected: number | undefined) {
  if (actual !== expected) throw new StatsError("stale-version", "Review the current reconciliation diff and pass its version before applying.", 409);
}
function cutoffDate(value: string) {
  try { if (completionTime(value) === null) throw new Error("Missing cutoff."); }
  catch { throw new StatsError("invalid-cutoff", "An explicit canonical UTC cutoff is required.", 400); }
  if (Date.parse(value) > Date.now()) throw new StatsError("invalid-cutoff", "The cleanup cutoff cannot be in the future.", 400);
  return value;
}

export async function statsHealth(db: Firestore, actorId: string, options: { after?: string; limit?: number } = {}) {
  const limit = pageLimit(options.limit);
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let query = db.collection(`${STATS_ROOT}/games`).orderBy(FieldPath.documentId());
    if (options.after) query = query.startAfter(statsId(options.after));
    const records = await tx.get(query.select("published", "queueTags", "reviewDurationMs").limit(limit + 1));
    const published = records.docs.slice(0, limit).filter((game) => game.data().published);
    return { publishedGames: published.length, fullyMappedGames: published.filter((game) => !(game.data().queueTags as string[]).includes("unresolved")).length,
      reviewDurationTotalMs: published.reduce((sum, game) => sum + (game.data().reviewDurationMs ?? 0), 0),
      reviewDurationSamples: published.filter((game) => typeof game.data().reviewDurationMs === "number").length,
      nextAfter: records.size > limit ? records.docs[limit - 1].id : null };
  }, { readOnly: true });
}

/** Compare and replace projections against the selected snapshot. Never reads rooms. */
export async function rebuildStatsGame(db: Firestore, actorId: string, gameId: string, options: { apply?: boolean; expectedVersion?: number } = {}) {
  const ref = db.doc(statsPaths.game(gameId)), audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("game-not-found", "Saved game not found.", 404);
    const game = document.data() as StatsGameRecord;
    if (options.apply) expectedVersion(game.version, options.expectedVersion);
    const snapshot = await loadSnapshot(tx, db, gameId, game.snapshotId), review = await loadReview(tx, db, gameId, game);
    const projection = projectGame(snapshot, review, game.version);
    const plan = await planContributionReplacement(tx, db, gameId, review, review, game.published, projection);
    const changes: string[] = [];
    if (stableJson(game.summary) !== stableJson(projection.summary)) changes.push(`${ref.path}.summary`);
    if (stableJson(game.queueTags) !== stableJson(gameQueueTags(snapshot, review, projection.summary, game.published))) changes.push(`${ref.path}.queueTags`);
    for (const write of plan.writes) {
      const stored = (await tx.get(write.ref)).data() ?? null;
      const comparable = (data: FirebaseFirestore.DocumentData | null) => {
        if (data === null) return null;
        const value = { ...data }; delete value.version; delete value.updatedAt; return value;
      };
      if (stableJson(comparable(stored)) !== stableJson(comparable(write.data))) changes.push(write.ref.path);
    }
    if (!options.apply || !changes.length) return { gameId, snapshotId: game.snapshotId, version: game.version, changed: changes.length > 0, applied: false, changes };
    const next = projectGame(snapshot, review, game.version + 1);
    const replacement = await planContributionReplacement(tx, db, gameId, review, review, game.published, next);
    const update = { summary: next.summary, queueTags: gameQueueTags(snapshot, review, next.summary, game.published), version: game.version + 1 };
    const event = { actorId, action: "rebuild-game", gameId, snapshotId: game.snapshotId, version: game.version + 1, changedFields: changes, at: new Date().toISOString() };
    assertWriteBudget([...replacement.writes, { ref, data: update }, { ref: audit, data: event }]);
    applyContributionPlan(tx, replacement); tx.update(ref, update); tx.create(audit, event);
    return { gameId, snapshotId: game.snapshotId, version: game.version + 1, changed: true, applied: true, changes };
  }, options.apply ? {} : { readOnly: true });
}

function aggregateEqual(left: StatsPersonRecord["player"], right: StatsPersonRecord["player"]) {
  const sameCounters = [...new Set([...Object.keys(left.counters), ...Object.keys(right.counters)])].every((key) => {
    const a = left.counters[key] ?? 0, b = right.counters[key] ?? 0;
    const count = key !== "teamPoints" && !/(Earned|Available|Sum)$/.test(key);
    return Number.isFinite(a) && Number.isFinite(b) && (count ? Number.isSafeInteger(a) && a === b : Math.abs(a - b) <= RECONCILIATION_TOLERANCE);
  });
  return sameCounters && stableJson(left.sort) === stableJson(right.sort);
}

/** Recompute one person's totals from validated published history and all saved mappings. */
export async function reconcileStatsPerson(db: Firestore, actorId: string, personId: string, options: { apply?: boolean; expectedVersion?: number } = {}) {
  const ref = db.doc(statsPaths.person(personId)), audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("person-not-found", "Person not found.", 404);
    const person = document.data() as StatsPersonRecord;
    if (options.apply) expectedVersion(person.version, options.expectedVersion);
    const [players, hosts, mappings, hosted] = await Promise.all([
      tx.get(ref.collection("playerGames")), tx.get(ref.collection("hostedGames")),
      tx.get(db.collectionGroup("mappings").where("personId", "==", personId)),
      tx.get(db.collection(`${STATS_ROOT}/games`).where("review.hostPersonId", "==", personId)),
    ]);
    const playerRows = players.docs.map((row) => row.data() as StatsPlayerContribution), hostRows = hosts.docs.map((row) => row.data() as StatsHostContribution);
    const rows = [...playerRows, ...hostRows];
    const games = new Map<string, StatsGameRecord | undefined>();
    for (const id of new Set(rows.map((row) => row.gameId))) games.set(id, (await tx.get(db.doc(statsPaths.game(id)))).data() as StatsGameRecord | undefined);
    for (const row of rows) if (row.personId !== personId || !games.get(row.gameId)?.published || games.get(row.gameId)?.version !== row.gameVersion) {
      throw new StatsError("history-integrity", "History references an unpublished, missing, or different game version. Rebuild the affected game first.", 409, { personId, gameId: row.gameId });
    }
    let player = replacePlayerAggregate(null, null, null), host = replaceHostAggregate(null, null, null);
    for (const row of playerRows) player = replacePlayerAggregate(player, null, row);
    for (const row of hostRows) host = replaceHostAggregate(host, null, row);
    const mappingCount = mappings.docs.filter((mapping) => /^stats\/global\/games\/[^/]+\/mappings\/[^/]+$/.test(mapping.ref.path)).length + hosted.size;
    const changes = [!aggregateEqual(person.player, player) && "player", !aggregateEqual(person.host, host) && "host",
      person.mappingCount !== mappingCount && "mappingCount", person.hasPlayerHistory !== Boolean(players.size) && "hasPlayerHistory", person.hasHostHistory !== Boolean(hosts.size) && "hasHostHistory"].filter((field): field is string => Boolean(field));
    if (!options.apply || !changes.length) return { personId, version: person.version, changed: changes.length > 0, applied: false, changes, historyRows: rows.length };
    const update = { player, host, mappingCount, hasPlayerHistory: Boolean(players.size), hasHostHistory: Boolean(hosts.size), version: person.version + 1, updatedAt: new Date().toISOString() };
    const event = { actorId, action: "reconcile-person", personId, version: person.version + 1, changedFields: changes, at: update.updatedAt };
    assertWriteBudget([{ ref, data: update }, { ref: audit, data: event }]);
    tx.update(ref, update); tx.create(audit, event);
    return { personId, version: person.version + 1, changed: true, applied: true, changes, historyRows: rows.length };
  }, options.apply ? {} : { readOnly: true });
}

/** Bounded integrity scan; caller checkpoints after IDs. No implicit repairs. */
export async function checkStatsIntegrity(db: Firestore, actorId: string, options: { after?: string; limit?: number } = {}) {
  const limit = pageLimit(options.limit);
  let cursor: { kind: "games" | "people"; id: string } = { kind: "games", id: "" };
  if (options.after) {
    try { cursor = JSON.parse(options.after); }
    catch { throw new StatsError("invalid-cursor", "Invalid integrity cursor.", 400); }
    if (!cursor || !["games", "people"].includes(cursor.kind) || typeof cursor.id !== "string") throw new StatsError("invalid-cursor", "Invalid integrity cursor.", 400);
  }
  const records = await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let query = db.collection(`${STATS_ROOT}/${cursor.kind}`).orderBy(FieldPath.documentId());
    if (cursor.id) query = query.startAfter(statsId(cursor.id));
    return tx.get(query.limit(limit + 1));
  }, { readOnly: true });
  const results = [];
  for (const record of records.docs.slice(0, limit)) {
    try { results.push(cursor.kind === "games" ? await rebuildStatsGame(db, actorId, record.id) : await reconcileStatsPerson(db, actorId, record.id)); }
    catch (error) {
      if (error instanceof StatsError && error.status >= 400 && error.status < 500 && ![401, 403].includes(error.status)) {
        results.push({ id: record.id, kind: cursor.kind, changed: true, code: error.code, message: error.message, details: error.details });
      } else {
        if (error instanceof StatsError) throw error;
        throw new Error(`Integrity check failed for ${cursor.kind}/${record.id}. Run its targeted diff to inspect the failure.`, { cause: error });
      }
    }
  }
  return { results, nextAfter: records.size > limit ? JSON.stringify({ kind: cursor.kind, id: records.docs[limit - 1].id }) : cursor.kind === "games" ? JSON.stringify({ kind: "people", id: "" }) : null };
}

/** Claim before deleting. Selection/copy transactions read these same documents and conflict safely. */
export async function deleteUnselectedSnapshot(db: Firestore, actorId: string, gameId: string, snapshotId: string, cutoff: string, apply = false) {
  cutoffDate(cutoff);
  const ref = db.doc(statsPaths.snapshot(gameId, snapshotId));
  const audit = db.doc(statsPaths.audit(randomUUID()));
  const eligible = await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const [game, snapshot] = await Promise.all([tx.get(db.doc(statsPaths.game(gameId))), tx.get(ref)]);
    if (!snapshot.exists || game.data()?.snapshotId === snapshotId || !(snapshot.data()!.snapshotAt < cutoff)) return false;
    if (apply) {
      tx.update(ref, { deleting: true, ready: false });
      if (snapshot.data()?.deleting !== true) tx.create(audit, { actorId, action: "cleanup-snapshot", gameId, snapshotId, at: new Date().toISOString() });
    }
    return true;
  }, apply ? {} : { readOnly: true });
  if (eligible && apply) {
    // Keep the claimed root until every child deletion succeeds, so an interrupted cleanup is resumable.
    for (const collection of await ref.listCollections()) await db.recursiveDelete(collection);
    await db.runTransaction(async (tx) => {
      await assertStatsAdmin(tx, db, actorId);
      const [game, snapshot] = await Promise.all([tx.get(db.doc(statsPaths.game(gameId))), tx.get(ref)]);
      if (game.data()?.snapshotId === snapshotId || (snapshot.exists && snapshot.data()?.deleting !== true)) throw new StatsError("cleanup-conflict", "The cleanup claim changed. The snapshot was retained.", 409);
      if (snapshot.exists) tx.delete(ref);
    });
  }
  return { gameId, snapshotId, eligible, deleted: eligible && apply };
}

export async function cleanupStatsSnapshots(db: Firestore, actorId: string, options: { cutoff: string; apply?: boolean; after?: string; limit?: number }) {
  const cutoff = cutoffDate(options.cutoff), limit = pageLimit(options.limit);
  const candidates = await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let query = db.collectionGroup("snapshots").where("snapshotAt", "<", cutoff).orderBy("snapshotAt").orderBy(FieldPath.documentId());
    if (options.after) {
      const values = JSON.parse(options.after) as unknown;
      if (!Array.isArray(values) || values.length !== 2 || typeof values[0] !== "string" || typeof values[1] !== "string" || !/^(?:[^/]+\/[^/]+\/)*snapshots\/[^/]+$/.test(values[1])) throw new StatsError("invalid-cursor", "Invalid cleanup cursor.", 400);
      query = query.startAfter(values[0], db.doc(values[1]));
    }
    return tx.get(query.limit(limit + 1));
  }, { readOnly: true });
  const page = candidates.docs.slice(0, limit), results = [];
  for (const snapshot of page) if (/^stats\/global\/games\/[^/]+\/snapshots\/[^/]+$/.test(snapshot.ref.path)) {
    results.push(await deleteUnselectedSnapshot(db, actorId, snapshot.ref.parent.parent!.id, snapshot.id, cutoff, options.apply));
  }
  const last = page.at(-1);
  return { results, nextAfter: candidates.size > limit && last ? JSON.stringify([last.data().snapshotAt, last.ref.path]) : null };
}

/** Audit retention is opt-in with a separate cutoff. Selected snapshots are never audit cleanup targets. */
export async function cleanupStatsAudit(db: Firestore, actorId: string, options: { cutoff: string; apply?: boolean; after?: string; limit?: number }) {
  const cutoff = cutoffDate(options.cutoff), limit = pageLimit(options.limit);
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let query = db.collection(`${STATS_ROOT}/audit`).where("at", "<", cutoff).orderBy("at").orderBy(FieldPath.documentId());
    if (options.after) { const values = JSON.parse(options.after) as unknown;
      if (!Array.isArray(values) || values.length !== 2 || typeof values[0] !== "string" || typeof values[1] !== "string") throw new StatsError("invalid-cursor", "Invalid audit cleanup cursor.", 400);
      query = query.startAfter(values[0], statsId(values[1])); }
    const candidates = await tx.get(query.limit(limit + 1)), page = candidates.docs.slice(0, limit), last = page.at(-1);
    if (options.apply) page.forEach((event) => tx.delete(event.ref));
    return { count: page.length, deleted: options.apply ? page.length : 0, nextAfter: candidates.size > limit && last ? JSON.stringify([last.data().at, last.id]) : null };
  }, options.apply ? {} : { readOnly: true });
}
