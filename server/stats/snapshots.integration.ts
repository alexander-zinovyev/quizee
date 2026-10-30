import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { StatsError } from "./error";
import { statsPaths, STATS_ROOT } from "./model";
import { normalizeRoomSource, readEndedRoom } from "./source";
import { roomSourceFixture, sourceFixtureDocuments } from "./source.fixtures";
import { loadSnapshot, prepareSnapshot, saveSnapshot, snapshotDocuments } from "./snapshots";

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Snapshot integration tests require the Firestore emulator.");
  const app = initializeApp({ projectId: "demo-quizee-drafts" }, "stats-snapshots");
  const db = getFirestore(app);
  const room = db.doc("rooms/demo"), admin = db.doc("roles/stats-snapshot-admin");
  const game = db.doc(statsPaths.game("demo")), person = db.doc(statsPaths.person("snapshot-person"));
  const source = roomSourceFixture(11);
  const sourceDocuments = sourceFixtureDocuments(source);
  try {
    for (let offset = 0; offset < sourceDocuments.length; offset += 200) {
      const batch = db.batch();
      sourceDocuments.slice(offset, offset + 200).forEach(({ path, data }) => batch.set(db.doc(path), data));
      await batch.commit();
    }
    await admin.set({ admin: true });
    const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof StatsError && error.code === code);
    await rejectsCode(prepareSnapshot(db, "demo", "not-admin", 0), "forbidden");
    await room.update({ state: "playing" });
    await rejectsCode(readEndedRoom(db, "demo"), "room-not-ended");
    await room.update({ state: "ended" });

    const started = performance.now();
    const prepared = await prepareSnapshot(db, "demo", "stats-snapshot-admin", 0);
    const readSaved = () => db.runTransaction((tx) => loadSnapshot(tx, db, "demo", prepared.snapshotId), { readOnly: true });
    const saved = await readSaved();
    const normalized = normalizeRoomSource(await readEndedRoom(db, "demo"), prepared.snapshotId);
    assert.deepEqual(saved, { ...normalized, snapshotAt: saved.snapshotAt });
    assert.equal(saved.rounds[9].id, "round-10", "Round order must survive storage document-ID sorting.");
    assert.equal(saved.rounds[0].questions[9].id, "question-10");
    const initialGame = (await game.get()).data()!;
    assert.equal(initialGame.published, false);
    assert.equal(initialGame.version, 1);

    // Mutating live scores after copying never changes the saved score baseline.
    await db.doc("rooms/demo/teams/red").update({ scoreTotal: -999 });
    await db.doc("rooms/demo/rounds/round-1/teamAnswers/red/answers/question-1").update({ awardedPoints: 888 });
    assert.deepEqual((await readSaved()).teams, saved.teams);
    assert.equal((await readSaved()).rounds[0].questions[0].answers.red.awardedPoints, 1);
    const next = normalizeRoomSource(await readEndedRoom(db, "demo"), "new-preview");
    assert.notEqual(next.digest, prepared.digest);
    await rejectsCode(prepareSnapshot(db, "demo", "stats-snapshot-admin", 0), "stale-version");

    // A changed roster is explicitly unresolved on refresh; existing mapping counters stay coherent.
    const appearance = saved.appearances.find((appearance) => saved.sourceMembers[appearance.id] === "red-uid-0")!;
    await person.set({ version: 1, mappingCount: 1 });
    await game.collection("mappings").doc(appearance.id).set({ personId: person.id, duplicateOf: null });
    await db.doc("rooms/demo/members/red-uid-0").update({ name: "Corrected alias" });
    const refresh = await prepareSnapshot(db, "demo", "stats-snapshot-admin", 1);
    assert.equal(refresh.version, 2);
    assert.equal((await person.get()).data()!.mappingCount, 0);
    assert.deepEqual((await game.collection("mappings").doc(appearance.id).get()).data(), { personId: null, duplicateOf: null, needsReview: true });
    assert.equal((await readSaved()).appearances.find((entry) => entry.id === appearance.id)!.alias, appearance.alias);

    // Removed source entries must not leave invalid mapping or maximum references in a new review.
    const removedAppearance = saved.appearances.find((entry) => saved.sourceMembers[entry.id] === "blue-uid-0")!;
    await person.update({ mappingCount: 1 });
    await game.collection("mappings").doc(removedAppearance.id).set({ personId: person.id, duplicateOf: null });
    const removedOverride = game.collection("questionOverrides").doc("removed-question");
    await removedOverride.set({ roundId: "round-1", questionId: "question-2", points: 2 });
    await db.doc("rooms/demo/members/blue-uid-0").delete();
    await db.doc("rooms/demo/rounds/round-1/questions/question-2").delete();
    await prepareSnapshot(db, "demo", "stats-snapshot-admin", 2);
    assert.equal((await game.collection("mappings").doc(removedAppearance.id).get()).exists, false);
    assert.equal((await removedOverride.get()).exists, false);
    assert.equal((await person.get()).data()!.mappingCount, 0);

    await game.update({ published: true });
    await rejectsCode(prepareSnapshot(db, "demo", "stats-snapshot-admin", 3), "already-published");
    await admin.update({ admin: false });
    await rejectsCode(prepareSnapshot(db, "demo", "stats-snapshot-admin", 3), "forbidden");

    // A failure after the first copy batch must never make a partial snapshot usable.
    const interrupted = normalizeRoomSource(source, "interrupted");
    const documents = snapshotDocuments(interrupted);
    await db.doc(documents.at(-1)!.path).set(documents.at(-1)!.data);
    await assert.rejects(saveSnapshot(db, interrupted));
    assert.equal((await db.doc(statsPaths.snapshot("demo", "interrupted")).get()).data()!.ready, false);
    await rejectsCode(db.runTransaction((tx) => loadSnapshot(tx, db, "demo", "interrupted"), { readOnly: true }), "snapshot-not-ready");

    // A completed copy claimed just before selection must not become the selected baseline.
    await admin.update({ admin: true }); await game.update({ published: false });
    const previousSelection = (await game.get()).data()!.snapshotId;
    const knownCopies = new Set((await game.collection("snapshots").get()).docs.map((document) => document.id));
    const beforeSelection = new Proxy(db, { get(target, property) {
      if (property === "runTransaction") return async (work: (tx: Transaction) => Promise<unknown>, options?: FirebaseFirestore.ReadOnlyTransactionOptions | FirebaseFirestore.ReadWriteTransactionOptions) => {
        if (!options?.readOnly) {
          const ready = await game.collection("snapshots").where("ready", "==", true).get();
          for (const candidate of ready.docs) if (!knownCopies.has(candidate.id)) await candidate.ref.update({ deleting: true, ready: false });
        }
        return target.runTransaction(work, options ?? {});
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    await rejectsCode(prepareSnapshot(beforeSelection, "demo", "stats-snapshot-admin", 3), "snapshot-not-ready");
    assert.equal((await game.get()).data()!.snapshotId, previousSelection);

    // Cleanup may claim an unselected copy between chunks. No later chunk or finalizer may revive it.
    const collecting = normalizeRoomSource(source, "cleanup-race"), collectingRef = db.doc(statsPaths.snapshot("demo", collecting.id));
    let copyCommits = 0;
    const afterCommit = async () => { if (++copyCommits === 1) await collectingRef.update({ deleting: true, ready: false }); };
    const duringCleanup = new Proxy(db, { get(target, property) {
      if (property === "batch") return () => { const batch = target.batch(); return new Proxy(batch, { get(original, key) {
        if (key === "commit") return async () => { const result = await original.commit(); await afterCommit(); return result; };
        const value = Reflect.get(original, key); return typeof value === "function" ? value.bind(original) : value;
      } }); };
      if (property === "runTransaction") return async (work: (tx: Transaction) => Promise<unknown>) => {
        const result = await target.runTransaction(work); await afterCommit(); return result;
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    await rejectsCode(saveSnapshot(duringCleanup, collecting), "snapshot-not-ready");
    assert.equal((await collectingRef.get()).data()!.ready, false);

    console.log(`Snapshot integration verified: ${sourceDocuments.length} source documents, ordered immutable copy, refresh/conflict/revocation/partial-copy paths; ${Math.round(performance.now() - started)} ms local emulator elapsed (not a production latency target).`);
  } finally {
    await db.recursiveDelete(room);
    await db.recursiveDelete(game);
    await person.delete();
    const audits = await db.collection(`${STATS_ROOT}/audit`).where("actorId", "==", "stats-snapshot-admin").get();
    const cleanup = db.batch();
    audits.docs.forEach((audit) => cleanup.delete(audit.ref));
    cleanup.delete(admin);
    await cleanup.commit();
    await db.terminate();
    await deleteApp(app);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
