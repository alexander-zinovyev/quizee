import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { StatsSnapshot } from "@/types/stats";
import { assertStatsAdmin } from "./authorization";
import { StatsError } from "./error";
import { calculateOutcomes } from "./metrics";
import { gameSortValues, statsPaths, type StatsGameRecord } from "./model";
import { normalizeRoomSource, readEndedRoom } from "./source";

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
  const commit = async () => {
    const batch = db.batch();
    chunk.forEach(({ path, data }) => batch.create(db.doc(path), data));
    await batch.commit();
    chunk = []; bytes = 0;
  };
  for (const document of documents) {
    const size = Buffer.byteLength(JSON.stringify(document), "utf8");
    if (chunk.length && (chunk.length >= 200 || bytes + size > 4 * 1024 * 1024)) await commit();
    chunk.push(document); bytes += size;
  }
  if (chunk.length) await commit();
  await db.doc(documents[0].path).update({ ready: true });
}

/** All dependencies use the caller's consistent read snapshot. Never consults rooms. */
export async function loadSnapshot(tx: Transaction, db: Firestore, gameId: string, snapshotId: string): Promise<StatsSnapshot> {
  const ref = db.doc(statsPaths.snapshot(gameId, snapshotId));
  const metadata = await tx.get(ref);
  if (metadata.data()?.ready !== true) throw new StatsError("snapshot-not-ready", "The saved snapshot is unavailable or incomplete.", 409);
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
export async function prepareSnapshot(db: Firestore, gameId: string, actorId: string, expectedVersion: number) {
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
    const [mappings, overrides] = await Promise.all([tx.get(ref.collection("mappings")), tx.get(ref.collection("questionOverrides"))]);
    const oldSnapshot = previous ? await loadSnapshot(tx, db, gameId, previous.snapshotId) : null;
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
    tx.set(ref, { schemaVersion: 1, snapshotId: snapshot.id, version: expectedVersion + 1, published: false, publishedAt: null, review,
      summary: { sort: gameSortValues({ ...review, host: snapshot.host ? { personId: review.hostPersonId, alias: snapshot.host.alias } : null, teams: calculateOutcomes(snapshot.teams) }),
        unresolvedAppearances: snapshot.appearances.filter((appearance) => !mappings.docs.some((mapping) => mapping.id === appearance.id && mapping.data().personId && !reset.includes(mapping))).length,
        provisional: snapshot.rounds.some((round) => round.gradingIncomplete === true) } } satisfies StatsGameRecord);
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
