import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import type { StatsMapping } from "@/types/stats";
import { playerSummary } from "./aggregates";
import { changeGameReview, publishStatsGame } from "./commands";
import { StatsError } from "./error";
import { statsPaths, STATS_ROOT } from "./model";
import { createStatsPerson, editStatsPerson, searchStatsPeople } from "./people";
import { loadSnapshot, prepareSnapshot } from "./snapshots";
import { roomSourceFixture, sourceFixtureDocuments } from "./source.fixtures";
import { getAdminGame, listAdminGames, listStatsAudit } from "./admin-queries";
import { getPublicGame, getPublicHost, getPublicPlayer, getPublicRound, getPublishedAsset, listPublicGames, listPublicHistory, listPublicPlayers } from "./public-queries";

async function main() {
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "true";
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Publication tests require the Firestore emulator.");
  const app = initializeApp({ projectId: "demo-quizee-drafts" }, "stats-publication"), db = getFirestore(app);
  const actor = "publication-admin", gameId = "publication", source = roomSourceFixture(9, 10, gameId);
  const colorRound = source.rounds[3];
  colorRound.data.scoring = { mode: "proportional" };
  for (const team of source.teams) {
    const previous = team.scores.find((score) => score.id === colorRound.id)!;
    colorRound.teamAnswers[team.id].answers.forEach((answer) => {
      answer.data = { ...answer.data, perceptionScore: 8.57, awardedPoints: 0.857 };
    });
    const total = colorRound.teamAnswers[team.id].answers.reduce((sum, answer) => sum + Number(answer.data.awardedPoints), 0);
    team.data.scoreTotal = Number(team.data.scoreTotal) + total - Number(previous.data.score);
    previous.data.score = total;
  }
  const gameRef = db.doc(statsPaths.game(gameId)), roleRef = db.doc(`roles/${actor}`), people = new Set<string>();
  const eligibilityId = "publication-eligibility";
  const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof StatsError && error.code === code);
  try {
    const seed = sourceFixtureDocuments(source);
    for (let offset = 0; offset < seed.length; offset += 200) {
      const batch = db.batch(); seed.slice(offset, offset + 200).forEach(({ path, data }) => batch.set(db.doc(path), data)); await batch.commit();
    }
    await roleRef.set({ admin: true });
    const eligibilitySource = roomSourceFixture(1, 1, eligibilityId);
    const eligibilitySeed = db.batch();
    sourceFixtureDocuments(eligibilitySource).forEach(({ path, data }) => eligibilitySeed.set(db.doc(path), data));
    await eligibilitySeed.commit();
    const eligibility = await prepareSnapshot(db, eligibilityId, actor, 0);
    const beforeFinalTransaction = (before: () => Promise<unknown>) => new Proxy(db, {
      get(target, property) {
        if (property === "runTransaction") return async (work: (tx: Transaction) => Promise<unknown>, options?: { readOnly: boolean }) => {
          if (!options?.readOnly) await before();
          return target.runTransaction(work, options);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const eligibilityInput = { expectedVersion: 1, approvedDigest: eligibility.digest, acknowledgeIncompleteGrading: false };
    await rejectsCode(publishStatsGame(beforeFinalTransaction(() => db.doc(`rooms/${eligibilityId}`).update({ state: "playing" })), actor, eligibilityId, eligibilityInput), "room-not-ended");
    assert.equal((await db.doc(statsPaths.game(eligibilityId)).get()).data()!.published, false);
    await db.doc(`rooms/${eligibilityId}`).update({ state: "ended" });
    await rejectsCode(publishStatsGame(beforeFinalTransaction(() => roleRef.update({ admin: false })), actor, eligibilityId, eligibilityInput), "forbidden");
    assert.equal((await db.doc(statsPaths.game(eligibilityId)).get()).data()!.published, false);
    await roleRef.update({ admin: true });
    let prepared = await prepareSnapshot(db, gameId, actor, 0);
    const snapshot = await db.runTransaction((tx) => loadSnapshot(tx, db, gameId, prepared.snapshotId), { readOnly: true });
    await rejectsCode(getPublicGame(db, gameId), "not-found");
    await rejectsCode(getPublicRound(db, gameId, "round-1", 1), "not-found");
    const assetId = Object.keys(snapshot.assets)[0];
    await rejectsCode(getPublishedAsset(db, gameId, assetId), "not-found");
    assert.equal((await getAdminGame(db, actor, gameId)).snapshot?.id, prepared.snapshotId);
    assert.ok((await listAdminGames(db, actor, { tab: "unpublished" })).saved.items.some((game) => game.id === gameId));
    assert.equal((await listPublicGames(db)).items.length, 0);
    const hostId = randomUUID(); people.add(hostId);
    const mappings: Record<string, StatsMapping> = {};
    const createPeople = snapshot.appearances.map((appearance) => {
      const id = randomUUID(); people.add(id); mappings[appearance.id] = { personId: id, duplicateOf: null };
      return { id, displayName: appearance.alias ?? "Unknown", helperAliases: ["shared helper"], notes: "private matching evidence" };
    });
    createPeople.push({ id: hostId, displayName: "Host", helperAliases: [], notes: "" });
    const linked = await changeGameReview(db, actor, gameId, { expectedVersion: 1, mappings, hostPersonId: hostId, createPeople });
    assert.equal(linked.version, 2);
    for (const id of people) {
      const person = (await db.doc(statsPaths.person(id)).get()).data()!;
      assert.equal(person.mappingCount, 1);
      assert.equal(person.hasPlayerHistory, false);
      assert.equal(person.hasHostHistory, false);
    }
    const auditCount = async () => (await db.collection(`${STATS_ROOT}/audit`).where("actorId", "==", actor).get()).size;
    let count = await auditCount();
    const duplicate = await changeGameReview(db, actor, gameId, { expectedVersion: 1, mappings, hostPersonId: hostId, createPeople });
    assert.equal(duplicate.changed, false); assert.equal(await auditCount(), count);
    const redAppearance = snapshot.appearances.find((entry) => entry.teamId === "red")!;
    const redId = mappings[redAppearance.id].personId!;
    await rejectsCode(editStatsPerson(db, actor, redId, { expectedVersion: 1, archived: true }), "person-in-use");
    assert.ok((await searchStatsPeople(db, actor, "shared helper")).some((person) => person.id === redId));

    // Changed source invalidates review and produces a new private approval baseline.
    await db.doc(`rooms/${gameId}/teams/red`).update({ scoreTotal: 300 });
    await rejectsCode(publishStatsGame(db, actor, gameId, { expectedVersion: 2, approvedDigest: prepared.digest, acknowledgeIncompleteGrading: false }), "source-changed");
    const refreshedGame = (await gameRef.get()).data()!;
    assert.equal(refreshedGame.published, false);
    assert.equal(refreshedGame.version, 3);
    prepared = { snapshotId: refreshedGame.snapshotId, version: refreshedGame.version,
      digest: (await db.doc(statsPaths.snapshot(gameId, refreshedGame.snapshotId)).get()).data()!.digest };
    // Freeze provisional grading after acknowledging exactly the changed preview.
    await db.doc(`rooms/${gameId}/rounds/round-1`).update({ gradingRequired: true });
    prepared = await prepareSnapshot(db, gameId, actor, 3);
    await rejectsCode(publishStatsGame(db, actor, gameId, { expectedVersion: 4, approvedDigest: prepared.digest, acknowledgeIncompleteGrading: false }), "grading-acknowledgement-required");
    const [publication, competingPublication] = await Promise.all([1, 2].map(() => publishStatsGame(db, actor, gameId, { expectedVersion: 4, approvedDigest: prepared.digest, acknowledgeIncompleteGrading: true })));
    assert.deepEqual(competingPublication, publication, "Concurrent publication must pin one baseline and apply each contribution once.");
    assert.equal(publication.version, 5);
    const published = (await gameRef.get()).data()!;
    const baseline = await db.runTransaction((tx) => loadSnapshot(tx, db, gameId, published.snapshotId), { readOnly: true });
    assert.equal(published.summary.provisional, true);
    assert.equal(baseline.teams.find((team) => team.id === "red")!.score, 300);
    const historyRef = db.doc(statsPaths.playerGame(redId, gameId));
    assert.equal((await historyRef.get()).data()!.teamPoints, 300);
    assert.equal((await historyRef.get()).data()!.provisional, true);
    assert.equal((await db.doc(statsPaths.hostedGame(hostId, gameId)).get()).exists, true);
    assert.equal((await listPublicGames(db)).items.length, 1);
    assert.equal((await listPublicPlayers(db)).items.length, 6);
    const publicGame = await getPublicGame(db, gameId), publicPlayer = await getPublicPlayer(db, redId), publicHost = await getPublicHost(db, hostId);
    const publicColors = await getPublicRound(db, gameId, colorRound.id, 5);
    assert.ok(publicColors.items.length > 0);
    for (const question of publicColors.items) {
      assert.deepEqual(question.maximum, { points: 1, provenance: "configured" });
      assert.equal(question.answers.red.perceptionScore, 8.57);
      assert.equal(question.answers.red.awardedPoints, 0.857);
      assert.equal(question.answers.blue.awardedPoints, 0.857);
    }
    const colorMetrics = publicGame.metrics.rounds.find((round) => round.id === colorRound.id)!;
    assert.equal(colorMetrics.teams.red.score, source.teams[0].scores.find((score) => score.id === colorRound.id)!.data.score);
    assert.equal(colorMetrics.teams.red.percentage.denominator, 10);
    assert.equal(colorMetrics.teams.blue.percentage.denominator, 10);
    assert.equal(publicPlayer.summary.gamesPlayed, 1);
    assert.equal(publicHost.summary.gamesHosted, 1);
    assert.equal(publicPlayer.summary.teamPoints, 300);
    assert.equal(publicHost.medianTeamPercentage, null);
    const publicQuestions = await getPublicRound(db, gameId, "round-1", 5, { limit: 3 });
    assert.equal(publicQuestions.items.length, 3);
    assert.ok(publicQuestions.nextCursor);
    assert.equal((await getPublicRound(db, gameId, "round-1", 5, { limit: 3, cursor: publicQuestions.nextCursor })).items[0].order, 3);
    const payload = JSON.stringify([publicGame, publicPlayer, publicHost, publicQuestions]);
    for (const privateValue of ["private matching evidence", "red-uid-0", "host-uid", "sourceMembers", `rooms/${gameId}/media/`, "aliasesNormalized", "creationFingerprint"]) assert.equal(payload.includes(privateValue), false, privateValue);
    count = await auditCount();
    await db.doc(`rooms/${gameId}/teams/red`).update({ scoreTotal: -9999 });
    await db.doc(`rooms/${gameId}/rounds/round-1/teamAnswers/red/answers/question-1`).update({ awardedPoints: 9999 });
    await db.doc(`rooms/${gameId}`).update({ state: "playing" });
    const repeated = await publishStatsGame(db, actor, gameId, { expectedVersion: 0, approvedDigest: "old", acknowledgeIncompleteGrading: false });
    assert.deepEqual(repeated, publication);
    assert.equal(await auditCount(), count);
    assert.equal((await gameRef.get()).data()!.summary.metrics.results.find((team: { id: string }) => team.id === "red").score, 300);

    // Corrections and rebuild-shaped no-op replacement work even after the room is unavailable.
    await db.recursiveDelete(db.doc(`rooms/${gameId}`));
    assert.deepEqual(await publishStatsGame(db, actor, gameId, { expectedVersion: 0, approvedDigest: "old", acknowledgeIncompleteGrading: false }), publication);
    const replacementId = randomUUID(); people.add(replacementId);
    await createStatsPerson(db, actor, { id: replacementId, displayName: "Correct person" });
    await rejectsCode(changeGameReview(db, actor, gameId, { expectedVersion: 5, mappings: { [redAppearance.id]: { personId: replacementId, duplicateOf: null } } }), "impact-confirmation-required");
    const corrected = await changeGameReview(db, actor, gameId, { expectedVersion: 5, confirmedImpact: true,
      mappings: { [redAppearance.id]: { personId: replacementId, duplicateOf: null } }, maxima: [{ roundId: "round-1", questionId: "question-1", points: 5 }] });
    assert.equal(corrected.version, 6);
    await rejectsCode(getPublicRound(db, gameId, "round-1", 5, { cursor: publicQuestions.nextCursor }), "stale-version");
    assert.equal((await getPublicGame(db, gameId)).teams.find((team) => team.id === "red")!.score, 300);
    assert.equal((await getPublicPlayer(db, replacementId)).summary.teamPoints, 300);
    assert.equal((await listPublicHistory(db, replacementId, "player")).items[0].game.version, 6);
    assert.equal((await historyRef.get()).exists, false);
    const correctedHistory = (await db.doc(statsPaths.playerGame(replacementId, gameId)).get()).data()!;
    assert.equal(correctedHistory.teamPoints, 300);
    assert.equal(correctedHistory.provisional, true);
    assert.equal(correctedHistory.gameVersion, 6);
    assert.equal((await db.doc(statsPaths.person(redId)).get()).data()!.mappingCount, 0);
    const remainingRed = snapshot.appearances.find((entry) => entry.teamId === "red" && entry.id !== redAppearance.id)!;
    const remainingHistory = (await db.doc(statsPaths.playerGame(mappings[remainingRed.id].personId!, gameId)).get()).data()!;
    assert.ok(remainingHistory.roster.some((entry: { personId: string }) => entry.personId === replacementId));
    assert.equal(remainingHistory.gameVersion, 6);
    const previousPerson = (await db.doc(statsPaths.person(redId)).get()).data()!;
    assert.equal(playerSummary(previousPerson.player.counters).gamesPlayed, 0);
    await editStatsPerson(db, actor, redId, { expectedVersion: previousPerson.version, archived: true });
    assert.equal((await db.doc(statsPaths.person(redId)).get()).data()!.archived, true);
    await rejectsCode(getPublicPlayer(db, redId), "person-archived");
    await rejectsCode(changeGameReview(db, actor, gameId, { expectedVersion: 6, confirmedImpact: true, mappings: { [redAppearance.id]: { personId: redId, duplicateOf: null } } }), "person-archived");
    await rejectsCode(changeGameReview(db, actor, gameId, { expectedVersion: 5, confirmedImpact: true, packLabel: "Stale" }), "stale-version");
    assert.ok((await searchStatsPeople(db, actor, redAppearance.alias!)).some((person) => person.id === replacementId));

    const raceId = randomUUID(); people.add(raceId);
    await createStatsPerson(db, actor, { id: raceId, displayName: "Archive race" });
    const race = await Promise.allSettled([
      changeGameReview(db, actor, gameId, { expectedVersion: 6, confirmedImpact: true, mappings: { [redAppearance.id]: { personId: raceId, duplicateOf: null } } }),
      editStatsPerson(db, actor, raceId, { expectedVersion: 1, archived: true }),
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    const racedPerson = (await db.doc(statsPaths.person(raceId)).get()).data()!;
    assert.equal(racedPerson.mappingCount, racedPerson.archived ? 0 : 1);
    const currentVersion = (await gameRef.get()).data()!.version;
    const edits = await Promise.allSettled(["Pack A", "Pack B"].map((packLabel) => changeGameReview(db, actor, gameId, { expectedVersion: currentVersion, confirmedImpact: true, packLabel })));
    assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await gameRef.get()).data()!.version, currentVersion + 1);
    const finalSnapshot = await db.runTransaction((tx) => loadSnapshot(tx, db, gameId, (published.snapshotId)), { readOnly: true });
    assert.equal(finalSnapshot.rounds[0].questions[0].answers.red.awardedPoints, 1);
    assert.equal(finalSnapshot.teams.find((team) => team.id === "red")!.score, 300);
    const events = await listStatsAudit(db, actor);
    assert.ok(events.items.some((event) => event.action === "publish" && event.gameId === gameId));
    assert.ok(events.items.some((event) => event.action === "edit-review"));
    assert.ok(!JSON.stringify(events).includes("PRIVATE"));
    await rejectsCode(listStatsAudit(db, "not-an-admin"), "forbidden");
    console.log(`Publication/corrections verified: ${linked.workload.documents} review documents / ${linked.workload.jsonBytes} JSON bytes, private create-and-link, frozen baseline, concurrent publication, provisional warnings, identity/maxima replacement, competing edits, and archive races.`);
  } finally {
    await db.recursiveDelete(db.doc(`rooms/${eligibilityId}`)); await db.recursiveDelete(db.doc(statsPaths.game(eligibilityId)));
    await db.recursiveDelete(db.doc(`rooms/${gameId}`)); await db.recursiveDelete(gameRef);
    for (const id of people) await db.recursiveDelete(db.doc(statsPaths.person(id)));
    const audits = await db.collection(`${STATS_ROOT}/audit`).where("actorId", "==", actor).get();
    const cleanup = db.batch(); audits.docs.forEach((audit) => cleanup.delete(audit.ref)); cleanup.delete(roleRef); await cleanup.commit();
    await db.terminate(); await deleteApp(app);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
