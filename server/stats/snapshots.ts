import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { StatsSnapshot } from "@/types/stats";
import { assertStatsAdmin } from "./authorization";
import { StatsError } from "./error";
import { statsPaths, type StatsGameRecord } from "./model";
import { gameQueueTags, projectGame } from "./projection";
import { normalizeRoomSource, readEndedRoom } from "./source";
import { statsOperation } from "./telemetry";
import { cacheStatsRead } from "./read-cache";

export type SnapshotDocument = { path: string; data: FirebaseFirestore.DocumentData };

/** Chunk by semantic document boundaries; team answers never share one unbounded question document. */
export function snapshotDocuments(snapshot: StatsSnapshot): SnapshotDocument[] {
  const root = statsPaths.snapshot(snapshot.gameId, snapshot.id);
  const { teams, appearances, rounds, assets, sourceMembers, ...metadata } = snapshot;
  const documents: SnapshotDocument[] = [];
  teams.forEach((team) => documents.push({ path: `${root}/teams/${team.id}`, data: team }));
  appearances.forEach((appearance) => documents.push({ path: `${root}/appearances/${appearance.id}`, data: { ...appearance, sourceUid: sourceMembers[appearance.id] } }));
  Object.entries(assets).forEach(([id, data]) => documents.push({ path: `${root}/assets/${id}`, data }));
  rounds.forEach(({ questions, ...round }) => {
    documents.push({ path: `${root}/rounds/${round.id}`, data: round });
    questions.forEach(({ answers, ...question }) => {
      documents.push({ path: `${root}/rounds/${round.id}/questions/${question.id}`, data: question });
      Object.entries(answers).forEach(([teamId, data]) => documents.push({ path: `${root}/rounds/${round.id}/questions/${question.id}/answers/${teamId}`, data }));
    });
  });
  documents.unshift({ path: root, data: { ...metadata, sourceMembers: snapshot.host ? { [snapshot.host.appearanceId]: sourceMembers[snapshot.host.appearanceId] } : {},
    ready: false, documentCount: documents.length + 1, sourceReadAt: snapshot.snapshotAt } });
  return documents;
}

/** Creates only. An interrupted copy remains private and not ready; no selected snapshot is overwritten. */
export async function saveSnapshot(db: Firestore, snapshot: StatsSnapshot): Promise<void> {
  const documents = snapshotDocuments(snapshot);
  // This conservative JSON guard leaves room for Firestore field/path encoding below its 1 MiB limit.
  for (const document of documents) if (Buffer.byteLength(JSON.stringify(document.data), "utf8") > 768 * 1024) {
    throw new StatsError("snapshot-document-too-large", "A source document is too large to snapshot safely.", 422, { path: document.path });
  }
  let chunk: SnapshotDocument[] = [], bytes = 0;
  const root = db.doc(documents[0].path);
  let first = true;
  const commit = async () => {
    await db.runTransaction(async (tx) => {
      if (!first) {
        const metadata = await tx.get(root);
        if (!metadata.exists || metadata.data()?.deleting === true) throw new StatsError("snapshot-not-ready", "The unselected snapshot was claimed for cleanup.", 409);
      }
      chunk.forEach(({ path, data }) => tx.create(db.doc(path), data));
    });
    first = false;
    chunk = []; bytes = 0;
  };
  for (const document of documents) {
    const size = Buffer.byteLength(JSON.stringify(document), "utf8");
    if (chunk.length && (chunk.length >= 200 || bytes + size > 4 * 1024 * 1024)) await commit();
    chunk.push(document); bytes += size;
  }
  if (chunk.length) await commit();
  await db.runTransaction(async (tx) => {
    const metadata = await tx.get(root);
    if (!metadata.exists || metadata.data()?.deleting === true) throw new StatsError("snapshot-not-ready", "The unselected snapshot was claimed for cleanup.", 409);
    tx.update(root, { ready: true });
  });
  await cacheStatsRead(db, ["snapshot", snapshot.gameId, snapshot.id, snapshot.digest, String(documents.length)], async () => snapshot);
}

/** The manifest is always read in the caller's transaction; only immutable detail may use the shared cache. */
export async function loadSnapshot(tx: Transaction, db: Firestore, gameId: string, snapshotId: string, options: { cache?: boolean } = {}): Promise<StatsSnapshot> {
  const ref = db.doc(statsPaths.snapshot(gameId, snapshotId));
  const metadata = await tx.get(ref);
  if (metadata.data()?.ready !== true || metadata.data()?.deleting === true) throw new StatsError("snapshot-not-ready", "The saved snapshot is unavailable or incomplete.", 409);
  const read = () => loadSnapshotDetail(tx, db, ref, metadata);
  return options.cache ? cacheStatsRead(db, ["snapshot", gameId, snapshotId, metadata.data()!.digest, String(metadata.data()!.documentCount)], read) : read();
}

async function loadSnapshotDetail(tx: Transaction, db: Firestore, ref: FirebaseFirestore.DocumentReference,
  metadata: FirebaseFirestore.DocumentSnapshot): Promise<StatsSnapshot> {
  const [teams, appearances, assets, rounds] = await Promise.all([
    tx.get(ref.collection("teams")), tx.get(ref.collection("appearances")), tx.get(ref.collection("assets")), tx.get(ref.collection("rounds")),
  ]);
  let documentCount = 1 + teams.size + appearances.size + assets.size + rounds.size;
  const detail = await Promise.all(rounds.docs.map(async (round) => {
    const questions = await tx.get(round.ref.collection("questions"));
    documentCount += questions.size;
    const questionDetail = await Promise.all(questions.docs.map(async (question) => {
      const answers = await tx.get(question.ref.collection("answers"));
      documentCount += answers.size;
      return { ...question.data(), order: question.data().order as number, answers: Object.fromEntries(answers.docs.map((answer) => [answer.id, answer.data()])) };
    }));
    return { ...round.data(), order: round.data().order as number, questions: questionDetail.sort((a, b) => a.order - b.order) };
  }));
  if (documentCount !== metadata.data()!.documentCount) throw new StatsError("snapshot-incomplete", "The saved snapshot document count does not match its manifest.", 409);
  const data = { ...metadata.data()! };
  const sourceMembers = data.sourceMembers;
  delete data.ready; delete data.sourceReadAt; delete data.documentCount; delete data.sourceMembers;
  const members: Record<string, string> = { ...sourceMembers };
  const roster = appearances.docs.map((appearance) => {
    const { sourceUid, ...data } = appearance.data();
    members[appearance.id] = sourceUid;
    return data;
  });
  // Firestore stores the validated normalized contract; metadata is internal, never a public DTO.
  return { ...data, teams: teams.docs.map((team) => team.data()), appearances: roster,
    assets: Object.fromEntries(assets.docs.map((asset) => [asset.id, asset.data()])), sourceMembers: members,
    rounds: detail.sort((a, b) => a.order - b.order) } as StatsSnapshot;
}

function expectedGame(data: StatsGameRecord | undefined, expectedVersion: number) {
  if (data?.published) throw new StatsError("already-published", "Published snapshots cannot be refreshed.", 409);
  if ((data?.version ?? 0) !== expectedVersion) throw new StatsError("stale-version", "Game review changed. Reload before continuing.", 409);
}

/** A refresh selects a new immutable copy, preserving review records only when their roster is valid. */
export function prepareSnapshot(db: Firestore, gameId: string, actorId: string, expectedVersion: number) {
  return statsOperation("snapshot", { actorId, gameId }, () => prepareSnapshotCommand(db, gameId, actorId, expectedVersion));
}

async function prepareSnapshotCommand(db: Firestore, gameId: string, actorId: string, expectedVersion: number) {
  const ref = db.doc(statsPaths.game(gameId));
  await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    expectedGame((await tx.get(ref)).data() as StatsGameRecord | undefined, expectedVersion);
  }, { readOnly: true });
  const snapshot = normalizeRoomSource(await readEndedRoom(db, gameId), randomUUID());
  await saveSnapshot(db, snapshot);
  const auditRef = db.doc(statsPaths.audit(randomUUID()));
  await db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const game = await tx.get(ref);
    const previous = game.data() as StatsGameRecord | undefined;
    expectedGame(previous, expectedVersion);
    const metadata = await tx.get(db.doc(statsPaths.snapshot(gameId, snapshot.id)));
    if (metadata.data()?.ready !== true || metadata.data()?.deleting === true) throw new StatsError("snapshot-not-ready", "The copied snapshot is no longer available for selection.", 409);
    const [mappings, overrides] = await Promise.all([tx.get(ref.collection("mappings")), tx.get(ref.collection("questionOverrides"))]);
    const oldSnapshot = previous ? await loadSnapshot(tx, db, gameId, previous.snapshotId, { cache: true }) : null;
    const changed = new Set(oldSnapshot?.appearances.filter((old) => !snapshot.appearances.some((next) =>
      next.id === old.id && next.alias === old.alias && next.teamId === old.teamId)).map((old) => old.id));
    const reset = mappings.docs.filter((mapping) => changed.has(mapping.id) || changed.has(mapping.data().duplicateOf));
    const removedCounts = new Map<string, number>();
    reset.forEach((mapping) => {
      const personId = mapping.data().personId;
      if (personId) removedCounts.set(personId, (removedCounts.get(personId) ?? 0) + 1);
    });
    const hostChanged = oldSnapshot && JSON.stringify(oldSnapshot.host) !== JSON.stringify(snapshot.host);
    if (hostChanged && previous?.review.hostPersonId) removedCounts.set(previous.review.hostPersonId, (removedCounts.get(previous.review.hostPersonId) ?? 0) + 1);
    const people = await Promise.all([...removedCounts].map(async ([personId, count]) => {
      const person = await tx.get(db.doc(statsPaths.person(personId)));
      if (!person.exists || !Number.isSafeInteger(person.data()?.mappingCount) || person.data()!.mappingCount < count) throw new StatsError("mapping-integrity", "Person mapping counts are inconsistent.", 409);
      return { person, count };
    }));
    const review = { hostPersonId: hostChanged ? null : previous?.review.hostPersonId ?? null,
      completedAt: previous ? previous.review.completedAt : snapshot.completedAt, packLabel: previous ? previous.review.packLabel : snapshot.packLabel };
    const maxima: Record<string, Record<string, number>> = {};
    overrides.docs.forEach((override) => {
      const data = override.data();
      if (!snapshot.rounds.some((round) => round.id === data.roundId && round.questions.some((question) => question.id === data.questionId))) return;
      if (!Object.hasOwn(maxima, data.roundId)) maxima[data.roundId] = {};
      maxima[data.roundId][data.questionId] = data.points;
    });
    const completeReview = { ...review, maxima, mappings: Object.fromEntries(mappings.docs.filter((mapping) =>
      mapping.data().personId && !reset.includes(mapping)).map((mapping) => [mapping.id, { personId: mapping.data().personId, duplicateOf: mapping.data().duplicateOf ?? null }])) };
    const { summary } = projectGame(snapshot, completeReview, expectedVersion + 1);
    tx.set(ref, { schemaVersion: 1, snapshotId: snapshot.id, version: expectedVersion + 1, published: false, publishedAt: null, review,
      reviewStartedAt: previous?.reviewStartedAt ?? oldSnapshot?.snapshotAt ?? snapshot.snapshotAt,
      summary, queueTags: gameQueueTags(snapshot, completeReview, summary, false) } satisfies StatsGameRecord);
    reset.forEach((mapping) => {
      if (!snapshot.appearances.some((appearance) => appearance.id === mapping.id)) tx.delete(mapping.ref);
      else tx.set(mapping.ref, { personId: null, duplicateOf: null, needsReview: true });
    });
    overrides.docs.forEach((override) => {
      const data = override.data();
      if (!snapshot.rounds.some((round) => round.id === data.roundId && round.questions.some((question) => question.id === data.questionId))) tx.delete(override.ref);
    });
    people.forEach(({ person, count }) => tx.update(person.ref, { mappingCount: person.data()!.mappingCount - count, version: person.data()!.version + 1 }));
    tx.create(auditRef, { actorId, action: "snapshot", gameId, snapshotId: snapshot.id, resetAppearances: reset.map((mapping) => mapping.id), version: expectedVersion + 1, at: new Date().toISOString() });
  });
  return { snapshotId: snapshot.id, digest: snapshot.digest, version: expectedVersion + 1 };
}
