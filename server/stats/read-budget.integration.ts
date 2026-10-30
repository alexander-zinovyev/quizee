import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getAdminGame } from "./admin-queries";
import { replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { changeGameReview, publishStatsGame } from "./commands";
import { statsPaths, STATS_ROOT, type StatsHostContribution, type StatsPersonRecord, type StatsPlayerContribution } from "./model";
import { getPublicGame, getPublicHost, getPublicPlayer, listPublicGames, listPublicHistory } from "./public-queries";
import { configureStatsReadCache } from "./read-cache";
import { statsCacheFixture } from "./read-cache.fixtures";
import { prepareSnapshot } from "./snapshots";
import { roomSourceFixture, sourceFixtureDocuments } from "./source.fixtures";

function measure(db: Firestore) {
  let reads = 0;
  const paths: string[] = [];
  const measured = new Proxy(db, { get(target, property) {
    if (property === "runTransaction") return (work: (tx: Transaction) => Promise<unknown>, options?: { readOnly: true }) => target.runTransaction((tx) => work(new Proxy(tx, { get(original, key) {
      if (key === "get" || key === "getAll") return async (...args: unknown[]) => {
        const method = (Reflect.get(original, key) as (...args: unknown[]) => Promise<unknown>).bind(original);
        const result = await method(...args) as FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot | FirebaseFirestore.DocumentSnapshot[];
        reads += Array.isArray(result) ? result.length : "docs" in result ? Math.max(1, result.size) : 1;
        for (const arg of args) if (arg && typeof arg === "object" && "path" in arg) paths.push(String(arg.path));
        return result;
      };
      const value = Reflect.get(original, key); return typeof value === "function" ? value.bind(original) : value;
    } })), options);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { db: measured, async run<T>(load: () => Promise<T>) { const before = reads; paths.length = 0; const value = await load(); return { value, reads: reads - before, paths: [...paths] }; } };
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Read-budget tests require the Firestore emulator.");
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "true";
  const projectId = "demo-quizee-drafts", app = initializeApp({ projectId }, "stats-read-budget"), db = getFirestore(app);
  const actor = "read-budget-admin", gameId = "read-budget", role = db.doc(`roles/${actor}`), game = db.doc(statsPaths.game(gameId));
  const source = roomSourceFixture(9, 10, gameId), people = new Set<string>(), clones: string[] = [];
  source.room.data.completedAt = "2026-10-20T20:00:00.000Z";
  const shared = statsCacheFixture(), worker = measure(db), secondWorker = measure(db);
  for (const client of [worker.db, secondWorker.db]) configureStatsReadCache(client, shared.adapter, projectId);
  try {
    const seed = sourceFixtureDocuments(source);
    for (let offset = 0; offset < seed.length; offset += 200) {
      const batch = db.batch(); seed.slice(offset, offset + 200).forEach(({ path, data }) => batch.set(db.doc(path), data)); await batch.commit();
    }
    await role.set({ admin: true });
    let prepared = await prepareSnapshot(db, gameId, actor, 0);
    const cold = await worker.run(() => getAdminGame(worker.db, actor, gameId));
    const warm = await secondWorker.run(() => getAdminGame(secondWorker.db, actor, gameId));
    assert.deepEqual(warm.value, cold.value);
    assert.ok(cold.reads > 300);
    assert.ok(warm.reads <= 6, `Warm review used ${warm.reads} reads.`);
    await role.update({ admin: false });
    await assert.rejects(getAdminGame(secondWorker.db, actor, gameId), { code: "forbidden" });
    await role.update({ admin: true });
    const snapshotRef = db.doc(statsPaths.snapshot(gameId, prepared.snapshotId));
    await snapshotRef.update({ ready: false });
    await assert.rejects(getAdminGame(secondWorker.db, actor, gameId), { code: "snapshot-not-ready" });
    await snapshotRef.update({ ready: true });

    const snapshot = cold.value.snapshot!, hostId = randomUUID(); people.add(hostId);
    const mappings = Object.fromEntries(snapshot.appearances.map((appearance) => { const id = randomUUID(); people.add(id); return [appearance.id, { personId: id, duplicateOf: null }]; }));
    const createPeople = snapshot.appearances.map((appearance) => ({ id: mappings[appearance.id].personId, displayName: appearance.alias! }));
    createPeople.push({ id: hostId, displayName: "Host" });
    const saved = await worker.run(() => changeGameReview(worker.db, actor, gameId, { expectedVersion: 1, mappings, hostPersonId: hostId, createPeople }));
    assert.ok(saved.reads < 60, `Saving a warm review used ${saved.reads} reads.`);
    const linked = await worker.run(() => getAdminGame(worker.db, actor, gameId));
    assert.ok(linked.reads < 25);
    const coldMappedWorker = measure(db);
    configureStatsReadCache(coldMappedWorker.db, statsCacheFixture().adapter, projectId);
    const coldMapped = await coldMappedWorker.run(() => getAdminGame(coldMappedWorker.db, actor, gameId));
    assert.deepEqual(coldMapped.value, linked.value);
    assert.ok(coldMapped.reads > 300);

    // A different selected snapshot must not reuse the previous cached baseline.
    await db.doc(`rooms/${gameId}`).update({ title: "Changed title" });
    prepared = await prepareSnapshot(worker.db, gameId, actor, 2);
    const refreshed = await getAdminGame(secondWorker.db, actor, gameId);
    assert.equal(refreshed.snapshot!.id, prepared.snapshotId);
    assert.equal(refreshed.title, "Changed title");
    const copies = (await game.collection("snapshots").get()).size;
    const published = await publishStatsGame(worker.db, actor, gameId, { expectedVersion: 3, approvedDigest: prepared.digest, acknowledgeIncompleteGrading: false });
    assert.equal(published.snapshotId, prepared.snapshotId, "Publication must pin the approved immutable snapshot.");
    assert.equal((await game.collection("snapshots").get()).size, copies, "Publication must not copy the same snapshot again.");
    const finalReview = await worker.run(() => getAdminGame(worker.db, actor, gameId));
    assert.ok(finalReview.reads < 25);

    const playerId = mappings[snapshot.appearances[0].id].personId;
    const playerRef = db.doc(statsPaths.person(playerId)), hostRef = db.doc(statsPaths.person(hostId));
    const playerRow = (await db.doc(statsPaths.playerGame(playerId, gameId)).get()).data() as StatsPlayerContribution;
    const hostRow = (await db.doc(statsPaths.hostedGame(hostId, gameId)).get()).data() as StatsHostContribution;
    const storedGame = (await game.get()).data()!, header = (await db.doc(statsPaths.snapshot(gameId, published.snapshotId)).get()).data()!;
    let playerAggregate = replacePlayerAggregate(null, null, playerRow), hostAggregate = replaceHostAggregate(null, null, hostRow);
    const batch = db.batch();
    for (let index = 1; index < 100; index++) {
      const id = `read-budget-history-${String(index).padStart(3, "0")}`; clones.push(id);
      const nextPlayer = { ...playerRow, gameId: id }, nextHost = { ...hostRow, gameId: id };
      batch.set(db.doc(statsPaths.game(id)), storedGame);
      batch.set(db.doc(statsPaths.snapshot(id, published.snapshotId)), { ...header, gameId: id });
      batch.set(db.doc(statsPaths.playerGame(playerId, id)), nextPlayer);
      batch.set(db.doc(statsPaths.hostedGame(hostId, id)), nextHost);
      playerAggregate = replacePlayerAggregate(playerAggregate, null, nextPlayer);
      hostAggregate = replaceHostAggregate(hostAggregate, null, nextHost);
    }
    await batch.commit();
    const person = (await playerRef.get()).data() as StatsPersonRecord, host = (await hostRef.get()).data() as StatsPersonRecord;
    await playerRef.update({ version: person.version + 1, player: playerAggregate });
    await hostRef.update({ version: host.version + 1, host: hostAggregate });
    const coldPlayer = await worker.run(() => getPublicPlayer(worker.db, playerId));
    const warmPlayer = await secondWorker.run(() => getPublicPlayer(secondWorker.db, playerId));
    assert.equal(warmPlayer.value.summary.gamesPlayed, 100);
    assert.deepEqual(warmPlayer.value, coldPlayer.value);
    assert.ok(coldPlayer.reads >= 200);
    assert.ok(warmPlayer.reads <= 6);
    const coldHost = await worker.run(() => getPublicHost(worker.db, hostId));
    const warmHost = await secondWorker.run(() => getPublicHost(secondWorker.db, hostId));
    assert.deepEqual(warmHost.value, coldHost.value);
    assert.ok(coldHost.reads >= 200);
    assert.equal(warmHost.reads, 1);
    const firstPage = await listPublicHistory(worker.db, playerId, "player", { direction: "asc" });
    const cachedPage = await secondWorker.run(() => listPublicHistory(secondWorker.db, playerId, "player", { direction: "asc" }));
    assert.deepEqual(cachedPage.value, firstPage);
    assert.ok(cachedPage.reads <= 52);
    const global = await worker.run(() => listPublicGames(worker.db));
    assert.equal(global.paths.filter((path) => path === hostRef.path).length, 1, "A shared host is fetched once per page.");

    // Names remain live even when a different person's profile calculation is cached.
    const otherId = [...people].find((id) => id !== playerId && id !== hostId)!;
    const otherRef = db.doc(statsPaths.person(otherId));
    await otherRef.update({ displayName: "Renamed player" });
    const renamed = await getPublicPlayer(secondWorker.db, playerId);
    assert.ok([...renamed.teammates, ...renamed.opponents].some((row) => row.personId === otherId && row.displayName === "Renamed player"));
    const owner = (await playerRef.get()).data() as StatsPersonRecord;
    await playerRef.update({ archived: true });
    await assert.rejects(getPublicPlayer(secondWorker.db, playerId), { code: "person-archived" });
    await playerRef.update({ archived: false, version: owner.version + 1 });

    // A saved correction advances person versions and invalidates profile/history caches.
    const changed = await changeGameReview(worker.db, actor, gameId, { expectedVersion: 4, confirmedImpact: true, packLabel: "Corrected pack" });
    const correctedPlayer = await worker.run(() => getPublicPlayer(worker.db, playerId));
    assert.equal(correctedPlayer.value.version, (await playerRef.get()).data()!.version);
    assert.ok(correctedPlayer.reads >= 200);
    const correctedHistory = await listPublicHistory(secondWorker.db, playerId, "player", { direction: "asc" });
    assert.equal(correctedHistory.items.find((item) => item.game.id === gameId)!.game.version, changed.version);
    assert.equal((await getPublicGame(worker.db, gameId)).packLabel, "Corrected pack");
    console.log(JSON.stringify({ event: "stats.read-budget", review: { cold: cold.reads, warm: warm.reads, save: saved.reads, coldMapped: coldMapped.reads, mappedReload: linked.reads, publishedReload: finalReview.reads },
      player100Games: { cold: coldPlayer.reads, warm: warmPlayer.reads }, host100Games: { cold: coldHost.reads, warm: warmHost.reads }, historyPage: cachedPage.reads,
      note: "SDK document deliveries plus empty-query minimums; excludes index-entry billing and auth HTTP overhead." }));
  } finally {
    await db.recursiveDelete(db.doc(`rooms/${gameId}`));
    await db.recursiveDelete(game);
    for (const id of clones) await db.recursiveDelete(db.doc(statsPaths.game(id)));
    for (const id of people) await db.recursiveDelete(db.doc(statsPaths.person(id)));
    const audits = await db.collection(`${STATS_ROOT}/audit`).where("actorId", "==", actor).get();
    const cleanup = db.batch(); audits.docs.forEach((document) => cleanup.delete(document.ref)); cleanup.delete(role); await cleanup.commit();
    await db.terminate(); await deleteApp(app);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
