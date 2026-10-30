import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { changeGameReview, publishStatsGame } from "./commands";
import { statsPaths, type StatsGameRecord } from "./model";
import { newStatsPerson, searchStatsPeople } from "./people";
import { gameQueueTags, projectGame } from "./projection";
import { getPublicHost, getPublicPlayer, listPublicGames, listPublicHistory, listPublicPlayers } from "./public-queries";
import { STATS_SORTS } from "./queries";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture, sourceFixtureDocuments } from "./source.fixtures";
import { loadSnapshot, prepareSnapshot, snapshotDocuments } from "./snapshots";

const gameCount = 10000, personCount = 5000, historyCount = 1000, actor = "load-admin";
const gameId = (index: number) => `load-${String(index).padStart(5, "0")}`;
const personId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

async function main() {
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "true";
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("The load fixture is emulator-only.");
  const app = initializeApp({ projectId: "demo-quizee-drafts" }, "stats-load"), db = getFirestore(app);
  const started = performance.now(), writer = db.bulkWriter(); writer.onWriteError(() => false);
  let pending: Promise<unknown>[] = [], documents = 0, jsonBytes = 0, largestDocument = 0;
  async function put(path: string, data: FirebaseFirestore.DocumentData) {
    const bytes = Buffer.byteLength(JSON.stringify(data)); documents++; jsonBytes += bytes; largestDocument = Math.max(largestDocument, bytes);
    pending.push(writer.set(db.doc(path), data));
    if (pending.length >= 300) { await writer.flush(); await Promise.all(pending); pending = []; }
  }
  const base = normalizeRoomSource(roomSourceFixture(1, 2, gameId(0)), "readmodel");
  const review = { mappings: { [base.appearances.find((row) => row.teamId === "red")!.id]: { personId: personId(0), duplicateOf: null } },
    hostPersonId: personId(0), completedAt: "2026-01-01T00:00:00.000Z", packLabel: "Load fixture", maxima: { "round-1": { "question-1": 1, "question-2": 1 } } };
  let player = replacePlayerAggregate(null, null, null), host = replaceHostAggregate(null, null, null);
  try {
    await db.doc(`roles/${actor}`).set({ admin: true });
    for (let index = 0; index < gameCount; index++) {
      const snapshot = { ...base, gameId: gameId(index) }, completedAt = new Date(Date.UTC(2000, 0, index + 1)).toISOString();
      const currentReview = { ...review, completedAt }, projection = projectGame(snapshot, currentReview, 1);
      const game: StatsGameRecord = { schemaVersion: 1, version: 1, snapshotId: snapshot.id, published: true, publishedAt: snapshot.snapshotAt,
        review: { hostPersonId: null, completedAt, packLabel: currentReview.packLabel }, summary: projection.summary, queueTags: gameQueueTags(snapshot, currentReview, projection.summary, true) };
      await put(statsPaths.game(gameId(index)), game);
      // Header-only copies intentionally isolate archive/query costs from full question-copy costs.
      await put(statsPaths.snapshot(gameId(index), snapshot.id), { title: `Game ${index}`, snapshotAt: snapshot.snapshotAt, host: snapshot.host, ready: true });
      if (index < historyCount) {
        const row = projection.players.get(personId(0))!, hosted = projection.host!;
        row.aliases = [`Historic alias ${index}`]; row.aliasesNormalized = [`historic alias ${index}`]; hosted.alias = `Host alias ${index}`; hosted.aliasesNormalized = [`host alias ${index}`];
        await put(statsPaths.playerGame(personId(0), gameId(index)), row); await put(statsPaths.hostedGame(personId(0), gameId(index)), hosted);
        player = replacePlayerAggregate(player, null, row); host = replaceHostAggregate(host, null, hosted);
      }
    }
    const sample = projectGame(base, review, 1).players.get(personId(0))!;
    for (let index = 0; index < personCount; index++) {
      const id = personId(index), person = newStatsPerson({ id, displayName: `Load person ${index}` }, actor);
      person.player = index === 0 ? player : replacePlayerAggregate(null, null, { ...sample, personId: id });
      person.host = index === 0 ? host : person.host; person.hasPlayerHistory = true; person.hasHostHistory = index === 0; person.mappingCount = index === 0 ? historyCount * 2 : 1;
      await put(statsPaths.person(id), person);
      if (index) await put(statsPaths.playerGame(id, gameId(index)), { ...sample, personId: id, gameId: gameId(index) });
    }
    await writer.flush(); await Promise.all(pending); pending = [];
    const seedMs = Math.round(performance.now() - started);
    let deliveredDocuments = 0, readCalls = 0;
    const measured = new Proxy(db, { get(target, property) {
      if (property === "runTransaction") return (work: (tx: Transaction) => Promise<unknown>, options: { readOnly: true }) => target.runTransaction((tx) => work(new Proxy(tx, { get(original, key) {
        if (key === "get" || key === "getAll") return async (...args: unknown[]) => {
          const method = (Reflect.get(original, key) as (...args: unknown[]) => Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot | FirebaseFirestore.DocumentSnapshot[]>).bind(original), result = await method(...args); readCalls++;
          deliveredDocuments += Array.isArray(result) ? result.length : "docs" in result ? result.size : 1; return result;
        };
        const value = Reflect.get(original, key); return typeof value === "function" ? value.bind(original) : value;
      } })), options);
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    const queryStarted = performance.now();
    for (const kind of ["games", "players", "playerGames", "hostedGames"] as const) for (const sort of Object.keys(STATS_SORTS[kind])) for (const direction of ["asc", "desc"]) {
      const options = { sort, direction, limit: 25 };
      const list = kind === "games" ? await listPublicGames(measured, options) : kind === "players" ? await listPublicPlayers(measured, options)
        : await listPublicHistory(measured, personId(0), kind === "playerGames" ? "player" : "host", options);
      assert.equal(list.items.length, 25); assert.ok(list.nextCursor);
    }
    const counts = { games: 0, people: 0 };
    for (const kind of ["games", "people"] as const) {
      let cursor: string | null = null;
      do { const page: { items: unknown[]; nextCursor: string | null } = kind === "games" ? await listPublicGames(measured, { limit: 100, cursor }) : await listPublicPlayers(measured, { limit: 100, cursor }); counts[kind] += page.items.length; cursor = page.nextCursor; } while (cursor);
    }
    assert.deepEqual(counts, { games: gameCount, people: personCount });
    const profileStarted = performance.now(), publicPlayer = await getPublicPlayer(measured, personId(0)), publicHost = await getPublicHost(measured, personId(0));
    assert.equal(publicPlayer.aliases.length, historyCount); assert.equal(publicPlayer.summary.gamesPlayed, historyCount); assert.equal(publicHost.summary.gamesHosted, historyCount);
    assert.equal((await searchStatsPeople(measured, actor, "historic alias 999"))[0].id, personId(0));
    console.log(JSON.stringify({ fixture: "statistics-readmodel", games: gameCount, people: personCount, longestPlayerAndHostHistory: historyCount,
      documents, jsonBytes, largestDocument, seedMs, queryMs: Math.round(performance.now() - queryStarted), profilePairMs: Math.round(performance.now() - profileStarted),
      sdkReadCalls: readCalls, deliveredDocuments, note: "Local emulator; document deliveries are not billed-read estimates. Snapshot headers only; full question-copy/fan-out measured separately." }));

    const stressId = "load-fanout", source = roomSourceFixture(1, 10, stressId), template = source.rounds[0];
    source.teams = Array.from({ length: 20 }, (_, index) => ({ id: `team-${index}`, data: { name: `Team ${index}`, scoreTotal: 90 }, scores: Array.from({ length: 9 }, (_, round) => ({ id: `round-${round + 1}`, data: { score: 10 } })) }));
    source.members = [{ id: "host", data: { name: "Load host", role: "host", team: null } }, ...source.teams.flatMap((team) => Array.from({ length: 6 }, (_, index) => ({ id: `${team.id}-member-${index}`, data: { name: `${team.id} member ${index}`, role: "player", team: team.id } })))];
    source.rounds = Array.from({ length: 9 }, (_, index) => ({ ...structuredClone(template), id: `round-${index + 1}`, data: { ...template.data, order: index, title: `Round ${index + 1}` }, teamAnswers: Object.fromEntries(source.teams.map((team) => [team.id, structuredClone(template.teamAnswers.red)])) }));
    for (const { path, data } of sourceFixtureDocuments(source)) await put(path, data);
    await writer.flush(); await Promise.all(pending); pending = [];
    const fanoutStarted = performance.now(), prepared = await prepareSnapshot(db, stressId, actor, 0);
    const saved = await db.runTransaction((tx) => loadSnapshot(tx, db, stressId, prepared.snapshotId), { readOnly: true });
    const ids = new Map(saved.appearances.map((appearance, index) => [appearance.id, personId(personCount + index)])), hostId = personId(personCount + 121);
    const linked = await changeGameReview(db, actor, stressId, { expectedVersion: 1, hostPersonId: hostId,
      mappings: Object.fromEntries([...ids].map(([appearanceId, personId]) => [appearanceId, { personId, duplicateOf: null }])),
      createPeople: [...ids.values(), hostId].map((id) => ({ id, displayName: `Fanout ${id}` })),
      maxima: saved.rounds.flatMap((round) => round.questions.map((question) => ({ roundId: round.id, questionId: question.id, points: 1 }))) });
    await publishStatsGame(db, actor, stressId, { expectedVersion: linked.version, approvedDigest: prepared.digest, acknowledgeIncompleteGrading: false });
    const copy = snapshotDocuments(saved), sizes = copy.map((document) => Buffer.byteLength(JSON.stringify(document.data)));
    console.log(JSON.stringify({ fixture: "full-snapshot-and-publication", teams: 20, players: 120, rounds: 9, questions: 90,
      snapshotDocuments: copy.length, snapshotJsonBytes: sizes.reduce((a, b) => a + b, 0), largestSnapshotDocument: Math.max(...sizes),
      reviewWorkload: linked.workload, elapsedMs: Math.round(performance.now() - fanoutStarted), note: "Validated synthetic stress fixture, not a product limit or production SLO." }));
  } finally {
    await writer.close();
    // A dedicated demo emulator is disposable. Never execute this cleanup against a real project.
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-quizee-drafts/databases/(default)/documents`, { method: "DELETE" });
    assert.ok(response.ok, "Emulator cleanup failed.");
    await db.terminate(); await deleteApp(app);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
