import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp as initializeClient, deleteApp as deleteClient } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc, terminate } from "firebase/firestore";
import { saveImageMatch } from "@/lib/image-match-store";
import type { ImageMatchEdit } from "@/lib/image-matching";
import type { Presentation } from "./presentation";
import { availablePort, startApp } from "./test-http-app";

async function main() {
  const firestoreAddress = process.env.FIRESTORE_EMULATOR_HOST;
  const authAddress = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!firestoreAddress || !authAddress || ![firestoreAddress, authAddress].every((address) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${address}`).hostname))) {
    throw new Error("Image HTTP tests require local Firestore and Auth emulators.");
  }
  const projectId = "demo-quizee-drafts";
  const adminApp = initializeApp({ projectId }, "image-http-admin");
  const db = getAdminFirestore(adminApp), adminAuth = getAdminAuth(adminApp);
  const clients = ["host", "player", "teammate"].map((name) => {
    const app = initializeClient({ projectId, apiKey: "fake" }, `image-http-${name}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authAddress}`, { disableWarnings: true });
    const firestore = getFirestore(app);
    const location = new URL(`http://${firestoreAddress}`);
    connectFirestoreEmulator(firestore, location.hostname, Number(location.port));
    return { app, auth, firestore };
  });
  const roomId = `image-http-${randomUUID()}`;
  const room = db.collection("rooms").doc(roomId);
  const foreground: Presentation = { round: "foreground", question: "text-question", withAnswer: false, promptPage: 0, answerPage: 0 };
  const questionIds = ["q1", "q2", "q3"], imageIds = ["i1", "i2", "i3"];
  const correct = Object.fromEntries(questionIds.map((id, index) => [id, imageIds[index]]));
  const accounts: string[] = [];
  let server: ChildProcess | null = null;
  try {
    const users = await Promise.all(clients.map(async ({ auth }) => (await signInAnonymously(auth)).user));
    accounts.push(...users.map((user) => user.uid));
    const tokens = await Promise.all(users.map((user) => user.getIdToken()));
    const batch = db.batch();
    batch.set(room, { state: "playing", presenting: foreground });
    users.forEach((user, index) => batch.set(room.collection("members").doc(user.uid), {
      role: index === 0 ? "host" : "player", team: index === 0 ? null : "red",
    }));
    batch.set(room.collection("teams").doc("red"), { name: "Red", scoreTotal: 7 });
    batch.set(room.collection("teams").doc("blue"), { name: "Blue", scoreTotal: 3 });
    batch.set(room.collection("rounds").doc("foreground"), { type: "text", state: "active" });
    batch.set(room.collection("rounds").doc("foreground").collection("questions").doc("text-question"), { stages: [{ text: "Keep presenting this question" }] });
    for (const roundId of ["images", "race-images"]) {
      const round = room.collection("rounds").doc(roundId);
      batch.set(round, { type: "image", state: "active", gradingRequired: true });
      questionIds.forEach((id, index) => {
        batch.set(round.collection("questions").doc(id), { text: `Description ${index + 1}`, order: index });
        batch.set(round.collection("images").doc(imageIds[index]), { order: index });
        batch.set(round.collection("answers").doc(id), { answer: imageIds[index] });
      });
    }
    // Legacy packs saved only the image ID. Closure must retain this grading contract.
    const blueAnswers = room.collection("teams").doc("blue").collection("rounds").doc("images").collection("answers");
    batch.set(blueAnswers.doc("q1"), { answer: "i2" });
    batch.set(blueAnswers.doc("q2"), { answer: "i1" });
    batch.set(blueAnswers.doc("q3"), { answer: "i3" });
    await batch.commit();

    const save = (client: number, edit: ImageMatchEdit, roundId = "images") => saveImageMatch({
      db: clients[client].firestore, roomSlug: roomId, teamId: "red", roundId,
      questionIds, imageIds, uid: users[client].uid,
    }, edit);
    const liveAnswers = (roundId: string, teamId = "red") => room.collection("teams").doc(teamId).collection("rounds").doc(roundId).collection("answers");
    const frozenAnswers = (roundId: string, teamId = "red") => room.collection("rounds").doc(roundId).collection("teamAnswers").doc(teamId).collection("answers");
    const answerMap = (snapshot: { docs: Array<{ id: string; data: () => { answer?: unknown } }> }) =>
      Object.fromEntries(snapshot.docs.map((answer) => [answer.id, answer.data().answer]));
    const permissionDenied = (work: Promise<unknown>) => assert.rejects(work, (error: unknown) => (error as { code: string }).code === "permission-denied");

    await save(1, { type: "assign", questionId: "q1", imageId: "i1" });
    assert.equal((await getDocFromServer(doc(clients[2].firestore, liveAnswers("images").doc("q1").path))).data()?.answer, "i1");
    await save(2, { type: "assign", questionId: "q2", imageId: "i1" });
    assert.deepEqual(answerMap(await liveAnswers("images").get()), { q1: "", q2: "i1" });
    assert.equal((await getDocFromServer(doc(clients[1].firestore, liveAnswers("images").doc("q1").path))).data()?.answer, "");
    await save(2, { type: "assign", questionId: "q2", imageId: "i2" });
    await save(1, { type: "assign", questionId: "q1", imageId: "i1" });
    await save(1, { type: "lock", questionId: "q1", locked: true });
    assert.equal((await getDocFromServer(doc(clients[2].firestore, liveAnswers("images").doc("q1").path))).data()?.locked, true);
    await assert.rejects(save(2, { type: "assign", questionId: "q3", imageId: "i1" }), /Unlock the destination/);
    await assert.rejects(save(2, { type: "clear", questionId: "q1" }), /Unlock the match/);

    const port = await availablePort(); server = await startApp(port, projectId);
    const request = async (path: string, body: unknown, client = 0) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/rooms/${roomId}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[client]}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await response.json() };
    };
    assert.equal((await request("rounds/images/grade", {})).status, 409);
    assert.equal((await request("presenting", { expected: foreground, next: foreground, closeRound: "images" }, 1)).status, 403);
    const accepted = answerMap(await liveAnswers("images").get());
    const closed = await request("presenting", { expected: foreground, next: foreground, closeRound: "images" });
    assert.equal(closed.status, 200, JSON.stringify(closed.payload));
    assert.deepEqual((await room.get()).data()?.presenting, foreground);
    assert.equal((await room.collection("rounds").doc("images").get()).data()?.state, "closed");
    assert.deepEqual(answerMap(await frozenAnswers("images").get()), accepted);
    assert.deepEqual(answerMap(await frozenAnswers("images", "blue").get()), { q1: "i2", q2: "i1", q3: "i3" });
    for (const answer of (await frozenAnswers("images").get()).docs) {
      assert.deepEqual(Object.keys(answer.data()).sort(), ["answer", "user"]);
      assert.equal(answer.data().user, answer.id === "q1" ? users[1].uid : users[2].uid);
    }
    await assert.rejects(save(2, { type: "lock", questionId: "q1", locked: false }), /closed/);
    await permissionDenied(setDoc(doc(clients[2].firestore, liveAnswers("images", "blue").doc("q1").path), { answer: "i3" }, { merge: true }));
    assert.equal((await request("rounds/images/grade", {}, 1)).status, 403);
    const graded = await request("rounds/images/grade", {});
    assert.equal(graded.status, 200, JSON.stringify(graded.payload));
    const expectedScores = { red: 2, blue: 1 };
    for (const [teamId, score] of Object.entries(expectedScores)) {
      assert.equal((await room.collection("teams").doc(teamId).collection("scores").doc("images").get()).data()?.score, score);
      assert.equal((await room.collection("teams").doc(teamId).get()).data()?.scoreTotal, (teamId === "red" ? 7 : 3) + score);
      for (const answer of (await frozenAnswers("images", teamId).get()).docs) {
        assert.equal(answer.data().awardedPoints, Number(answer.data().answer === correct[answer.id]));
      }
    }
    assert.equal((await room.collection("rounds").doc("images").get()).data()?.gradingRequired, false);
    assert.equal((await request("rounds/images/grade", {})).status, 200);
    assert.equal((await room.collection("teams").doc("red").get()).data()?.scoreTotal, 9);
    assert.equal((await room.collection("teams").doc("blue").get()).data()?.scoreTotal, 4);

    // Either transaction may win. Every accepted edit must be included in the same frozen snapshot.
    await save(1, { type: "assign", questionId: "q1", imageId: "i1" }, "race-images");
    await save(2, { type: "assign", questionId: "q2", imageId: "i2" }, "race-images");
    const [racedMove, racedClose] = await Promise.allSettled([
      save(2, { type: "assign", questionId: "q2", imageId: "i1" }, "race-images"),
      request("presenting", { expected: foreground, next: foreground, closeRound: "race-images" }),
    ]);
    assert.equal(racedClose.status, "fulfilled");
    if (racedClose.status === "fulfilled") assert.equal(racedClose.value.status, 200, JSON.stringify(racedClose.value.payload));
    const expectedRace = racedMove.status === "fulfilled" ? { q1: "", q2: "i1" } : { q1: "i1", q2: "i2" };
    assert.deepEqual(answerMap(await liveAnswers("race-images").get()), expectedRace);
    assert.deepEqual(answerMap(await frozenAnswers("race-images").get()), expectedRace);
    assert.deepEqual((await room.get()).data()?.presenting, foreground);
    await assert.rejects(save(1, { type: "clear", questionId: "q1" }, "race-images"), /closed/);
    console.log("Verified authenticated image matching, teammate displacement and locks, HTTP closure snapshots, legacy grading, repeat-score idempotence, and the edit/closure race.");
  } finally {
    if (server && server.exitCode === null) {
      const stopped = new Promise<void>((resolve) => server!.once("exit", () => resolve()));
      server.kill("SIGTERM"); await stopped;
    }
    await Promise.all(clients.map(async ({ firestore, app }) => { await terminate(firestore); await deleteClient(app); }));
    await db.recursiveDelete(room);
    await Promise.all(accounts.map((uid) => adminAuth.deleteUser(uid)));
    await db.terminate(); await deleteApp(adminApp);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
