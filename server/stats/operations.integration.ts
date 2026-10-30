import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { playerSummary } from "./aggregates";
import { changeGameReview, publishStatsGame } from "./commands";
import { getAdminGame, listAdminGames, listStatsAudit } from "./admin-queries";
import { StatsError } from "./error";
import { statisticsIndexProbes } from "./index-probes";
import { statsPaths, STATS_ROOT } from "./model";
import { checkStatsIntegrity, cleanupStatsAudit, cleanupStatsSnapshots, deleteUnselectedSnapshot, rebuildStatsGame, reconcileStatsPerson, statsHealth } from "./operations";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture, sourceFixtureDocuments } from "./source.fixtures";
import { loadSnapshot, prepareSnapshot, saveSnapshot } from "./snapshots";

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Operations tests require the Firestore emulator.");
  const app = initializeApp({ projectId: "demo-quizee-drafts" }, "stats-operations"), db = getFirestore(app);
  const actor = "operations-admin", gameId = "ops-a", invalidId = "ops-b", activeId = "ops-c", orphanId = "ops-orphan", personId = randomUUID();
  const ref = db.doc(statsPaths.game(gameId));
  const code = (promise: Promise<unknown>, expected: string) => assert.rejects(promise, (error: unknown) => error instanceof StatsError && error.code === expected);
  try {
    await db.doc(`roles/${actor}`).set({ admin: true });
    for (const id of [gameId, invalidId, activeId]) {
      const fixture = roomSourceFixture(4, 2, id), batch = db.batch();
      sourceFixtureDocuments(fixture).forEach(({ path, data }) => batch.set(db.doc(path), data)); await batch.commit();
    }
    await db.doc(`rooms/${invalidId}/rounds/round-1`).update({ type: "unsupported" });
    await db.doc(`rooms/${activeId}`).update({ state: "playing" });
    await code(getAdminGame(db, "not-admin", gameId), "forbidden");
    const queue = await listAdminGames(db, actor);
    assert.deepEqual(queue.endedRooms.items.map((room) => room.id), [gameId, invalidId]);
    assert.equal((await getAdminGame(db, actor, gameId)).snapshot, null);
    assert.equal((await ref.get()).exists, false);
    await prepareSnapshot(db, gameId, actor, 0);
    await code(prepareSnapshot(db, invalidId, actor, 0), "unsupported-round");
    await code(prepareSnapshot(db, activeId, actor, 0), "room-not-ended");
    assert.equal((await db.doc(statsPaths.game(invalidId)).get()).exists, false);
    const initial = (await ref.get()).data()!, snapshot = await db.runTransaction((tx) => loadSnapshot(tx, db, gameId, initial.snapshotId), { readOnly: true });
    const appearance = snapshot.appearances.find((row) => row.teamId === "red")!;
    await changeGameReview(db, actor, gameId, { expectedVersion: 1, mappings: { [appearance.id]: { personId, duplicateOf: null } },
      createPeople: [{ id: personId, displayName: "Operations player" }], maxima: [{ roundId: "round-1", questionId: "question-1", points: 2 }], packLabel: "Verified label" });
    const preserved = (await ref.get()).data()!;
    await getAdminGame(db, actor, gameId);
    await listAdminGames(db, actor);
    assert.deepEqual((await ref.get()).data(), preserved, "Reopening the manual review preserves identity decisions.");
    const published = await publishStatsGame(db, actor, gameId, { expectedVersion: 2, approvedDigest: snapshot.digest, acknowledgeIncompleteGrading: false });
    const health = await statsHealth(db, actor);
    for (const probe of statisticsIndexProbes(db)) await probe.query.get();
    assert.equal(health.publishedGames, 1); assert.equal(health.fullyMappedGames, 0); assert.equal(health.reviewDurationSamples, 1); assert.ok(health.reviewDurationTotalMs >= 0);
    const personRef = db.doc(statsPaths.person(personId)), before = (await personRef.get()).data()!;
    await db.doc(`rooms/${gameId}/teams/red`).update({ scoreTotal: 999999 });
    await code(prepareSnapshot(db, gameId, actor, published.version), "already-published");
    await db.recursiveDelete(db.doc(`rooms/${gameId}`));
    assert.equal((await rebuildStatsGame(db, actor, gameId)).changed, false, "Rebuilds never need the live room.");
    await ref.update({ "summary.sort.topScore.value": 123456 });
    const diff = await rebuildStatsGame(db, actor, gameId);
    assert.ok(diff.changes.includes(`${ref.path}.summary`)); assert.equal(diff.applied, false);
    await code(rebuildStatsGame(db, actor, gameId, { apply: true, expectedVersion: diff.version - 1 }), "stale-version");
    const rebuilt = await rebuildStatsGame(db, actor, gameId, { apply: true, expectedVersion: diff.version });
    assert.equal(rebuilt.applied, true); assert.equal((await ref.get()).data()!.snapshotId, published.snapshotId);
    assert.equal((await rebuildStatsGame(db, actor, gameId)).changed, false);
    assert.deepEqual((await personRef.get()).data()!.player, before.player);
    assert.deepEqual((await reconcileStatsPerson(db, actor, personId)).changes, []);
    await personRef.update({ "player.counters.teamPoints": 2222, mappingCount: 42 });
    const personDiff = await reconcileStatsPerson(db, actor, personId);
    assert.deepEqual(personDiff.changes, ["player", "mappingCount"]);
    let nextAfter: string | null | undefined, detected = false;
    do { const page = await checkStatsIntegrity(db, actor, { after: nextAfter ?? undefined, limit: 1 }); detected ||= page.results.some((row) => row.changed); nextAfter = page.nextAfter; } while (nextAfter);
    assert.equal(detected, true);
    await reconcileStatsPerson(db, actor, personId, { apply: true, expectedVersion: personDiff.version });
    assert.deepEqual((await reconcileStatsPerson(db, actor, personId)).changes, []);
    assert.equal(playerSummary((await personRef.get()).data()!.player.counters).teamPoints, playerSummary(before.player.counters).teamPoints);
    await personRef.update({ "player.counters.gamesPlayed": 1 + 1e-10 });
    const invalidCount = await reconcileStatsPerson(db, actor, personId);
    assert.ok(invalidCount.changes.includes("player"), "Fractional counts must not pass numeric total reconciliation tolerance.");
    await reconcileStatsPerson(db, actor, personId, { apply: true, expectedVersion: invalidCount.version });
    const selectedRef = db.doc(statsPaths.snapshot(gameId, published.snapshotId));
    await selectedRef.update({ ready: false });
    const unavailable = await checkStatsIntegrity(db, actor);
    assert.ok(unavailable.results.some((row) => "code" in row && row.code === "snapshot-not-ready"), "Integrity reports a selected-copy failure with its record context.");
    await selectedRef.update({ ready: true });

    const cutoff = new Date().toISOString();
    assert.equal((await deleteUnselectedSnapshot(db, actor, gameId, published.snapshotId, cutoff, true)).eligible, false);
    const orphan = normalizeRoomSource(roomSourceFixture(2, 1, orphanId), "old-orphan"); orphan.snapshotAt = "2000-01-01T00:00:00.000Z";
    await saveSnapshot(db, orphan);
    assert.equal((await db.doc(statsPaths.game(orphanId)).get()).exists, false);
    assert.equal((await deleteUnselectedSnapshot(db, actor, orphanId, orphan.id, cutoff)).eligible, true);
    assert.equal((await db.doc(statsPaths.snapshot(orphanId, orphan.id)).get()).exists, true);
    const interruptedCleanup = new Proxy(db, { get(target, property) {
      if (property === "recursiveDelete") return async () => { throw new Error("Injected deletion failure"); };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    await assert.rejects(deleteUnselectedSnapshot(interruptedCleanup, actor, orphanId, orphan.id, cutoff, true), /Injected deletion failure/);
    assert.equal((await db.doc(statsPaths.snapshot(orphanId, orphan.id)).get()).data()!.deleting, true, "Failed deletion retains a discoverable cleanup claim.");
    const cleaned = await cleanupStatsSnapshots(db, actor, { cutoff, apply: true });
    assert.ok(cleaned.results.some((row) => row.gameId === orphanId && row.deleted));
    assert.equal((await db.doc(statsPaths.snapshot(orphanId, orphan.id)).get()).exists, false);
    assert.equal((await db.doc(statsPaths.snapshot(gameId, published.snapshotId)).get()).data()!.ready, true);
    await code(deleteUnselectedSnapshot(db, actor, gameId, published.snapshotId, "2099-01-01T00:00:00.000Z", true), "invalid-cutoff");
    const oldAudit = db.doc(statsPaths.audit("old-ops-event")); await oldAudit.set({ at: "2000-01-01T00:00:00.000Z", actorId: actor, action: "test", targetUid: "affected-account" });
    assert.equal((await listStatsAudit(db, actor)).items.find((event) => event.id === oldAudit.id)?.targetUid, "affected-account");
    assert.equal((await cleanupStatsAudit(db, actor, { cutoff: "2001-01-01T00:00:00.000Z" })).count, 1);
    assert.equal((await oldAudit.get()).exists, true);
    assert.equal((await cleanupStatsAudit(db, actor, { cutoff: "2001-01-01T00:00:00.000Z", apply: true })).deleted, 1);
    await db.doc(`roles/${actor}`).update({ admin: false });
    await code(rebuildStatsGame(db, actor, gameId), "forbidden");
    await code(cleanupStatsSnapshots(db, actor, { cutoff, apply: true }), "forbidden");
    console.log("Verified manual ended-room review, unsupported-candidate refusal, preserved review/publication, snapshot-only rebuild, targeted integrity repair, selected-snapshot protection, parentless-copy cleanup, explicit audit retention, and revocation.");
  } finally {
    for (const id of [gameId, invalidId, activeId, orphanId]) { await db.recursiveDelete(db.doc(`rooms/${id}`)); await db.recursiveDelete(db.doc(statsPaths.game(id))); }
    await db.recursiveDelete(db.doc(statsPaths.person(personId))); await db.doc(`roles/${actor}`).delete();
    const events = await db.collection(`${STATS_ROOT}/audit`).where("actorId", "==", actor).get(), batch = db.batch(); events.docs.forEach((event) => batch.delete(event.ref)); await batch.commit();
    await db.terminate(); await deleteApp(app);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
