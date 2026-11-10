import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { initializeApp as clientApp, deleteApp as deleteClient } from "firebase/app";
import { connectAuthEmulator, getAuth as clientAuth, signInAnonymously, type User } from "firebase/auth";
import { collection, query, where, getDocsFromServer, onSnapshot, connectFirestoreEmulator, doc, getFirestore as clientFirestore, getDocFromServer, setDoc, terminate } from "firebase/firestore";
import { connectStorageEmulator, getStorage as clientStorage, ref, getBytes, uploadBytes } from "firebase/storage";
import { purchaseClue, clueLedgerPath } from "./clues";
import { parsePresentation, transitionPresentation } from "./presentation";
import { availablePort, startApp } from "./test-http-app";

async function main() {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST, auth = process.env.FIREBASE_AUTH_EMULATOR_HOST, storage = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!firestore || !auth || !storage || ![firestore, auth, storage].every((address) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(`http://${address}`).hostname))) throw new Error("Clues HTTP tests require local Firestore, Auth, and Storage emulators.");
  const projectId = "demo-quizee-drafts", bucketName = `${projectId}.appspot.com`;
  const app = initializeApp({ projectId, storageBucket: bucketName }, "clues-test");
  const db = getFirestore(app), adminAuth = getAuth(app), bucket = getStorage(app).bucket();
  const clients = ["host", "a", "teammate", "b", "guest"].map((name) => {
    const app = clientApp({ projectId, apiKey: "fake", storageBucket: bucketName }, `clues-${name}`);
    const authClient = clientAuth(app); connectAuthEmulator(authClient, `http://${auth}`, { disableWarnings: true });
    const firestoreClient = clientFirestore(app); const location = new URL(`http://${firestore}`);
    connectFirestoreEmulator(firestoreClient, location.hostname, Number(location.port));
    const storageClient = clientStorage(app); const storageLocation = new URL(`http://${storage}`);
    connectStorageEmulator(storageClient, storageLocation.hostname, Number(storageLocation.port));
    return { app, authClient, firestoreClient, storageClient };
  });
  const roomId = `clues-${randomUUID()}`, room = db.doc(`rooms/${roomId}`), round = room.collection("rounds").doc("r1");
  const imagePath = `rooms/${roomId}/clue-media/test.png`;
  const audioPath = `rooms/${roomId}/clue-media/test.mp3`, videoPath = `rooms/${roomId}/clue-media/test.webm`;
  let server: ChildProcess | null = null;
  const users: User[] = [];
  try {
    for (const client of clients) users.push((await signInAnonymously(client.authClient)).user);
    const tokens = await Promise.all(users.map((user) => user.getIdToken()));
    let current = parsePresentation({ round: "r1", question: "q1", withAnswer: false });
    const clues = [{ id: "two", category: "Two", price: 2 }, { id: "three", category: "Three", price: 3 }, { id: "four", category: "Four", price: 4 }, { id: "audio", category: "Audio", price: 1 }, { id: "video", category: "Video", price: 1 }];
    const batch = db.batch();
    batch.set(room, { state: "playing", presenting: current });
    for (const [index, user] of users.entries()) if (index !== 4) batch.set(room.collection("members").doc(user.uid), { role: index === 0 ? "host" : "player", team: index === 0 ? null : index === 3 ? "blue" : "red" });
    for (const id of ["red", "blue"]) batch.set(room.collection("teams").doc(id), { name: id });
    batch.set(round, { type: "clues", state: "active", startingCoins: 5 });
    for (const id of ["q1", "q2"]) {
      batch.set(round.collection("questions").doc(id), { order: id === "q1" ? 0 : 1, stages: [{ text: id }], clues });
      batch.set(round.collection("answers").doc(id), { hint: "Paris", stages: [{ text: "Paris" }] });
      for (const clue of clues) batch.set(round.collection("questions").doc(id).collection("clues").doc(clue.id), { price: clue.price, content: { text: ["audio", "video"].includes(clue.id) ? null : `secret-${id}-${clue.id}`, media: clue.id === "two" ? { storagePath: imagePath, filename: "test.png" } : clue.id === "audio" ? { storagePath: audioPath, filename: "test.mp3" } : clue.id === "video" ? { storagePath: videoPath, filename: "test.webm" } : null } });
    }
    await batch.commit();
    await bucket.file(imagePath).save(Buffer.from("private-image"), { metadata: { contentType: "image/png", cacheControl: "no-store" } });
    await bucket.file(audioPath).save(Buffer.from("private-audio"), { metadata: { contentType: "audio/mpeg", cacheControl: "no-store" } });
    await bucket.file(videoPath).save(Buffer.from("private-video"), { metadata: { contentType: "video/webm", cacheControl: "no-store" } });
    const port = await availablePort(); server = await startApp(port, projectId); server.stderr!.pipe(process.stderr);
    const base = `http://127.0.0.1:${port}/api/rooms/${roomId}/rounds/r1/answers`;
    async function request(question: string, suffix = "", index = 1, body?: unknown) {
      const response = await fetch(`${base}/${question}/clues${suffix}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${tokens[index]}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, response, data: response.headers.get("Content-Type")?.includes("json") ? await response.json() : await response.text() };
    }
    const buy = (question: string, clue: string, index = 1, teamId = "red") => request(question, `/${clue}`, index, { teamId });
    const denied = (work: Promise<unknown>) => assert.rejects(work, (error: unknown) => ["permission-denied", "storage/unauthorized"].includes((error as { code: string }).code));
    const ledgerPath = clueLedgerPath(roomId, "red", "r1");
    const ledger = async (index = 1) => (await getDocFromServer(doc(clients[index].firestoreClient, clueLedgerPath(roomId, index === 3 ? "blue" : "red", "r1")))).data()?.remainingCoins ?? 5;
    const opened = async (question: string, index = 1) => (await getDocsFromServer(query(collection(clients[index].firestoreClient, `${clueLedgerPath(roomId, index === 3 ? "blue" : "red", "r1")}/openedClues`), where("questionId", "==", question)))).docs.map((item) => item.data());
    const definition = (question: string, clue: string, index = 1) => getDocFromServer(doc(clients[index].firestoreClient, `${round.path}/questions/${question}/clues/${clue}`));
    await denied(getDocFromServer(doc(clients[4].firestoreClient, ledgerPath)));
    assert.equal(await ledger(), 5);
    assert.deepEqual(await opened("q1"), []);
    assert.equal((await definition("q1", "two", 0)).data()?.content.text, "secret-q1-two");
    await denied(definition("q1", "two"));
    await room.update({ presenting: { ...current, revealedClueIds: ["two"] } });
    await denied(definition("q1", "two")); // A forged reveal cannot expose active-round content.
    await room.update({ presenting: current });
    assert.equal((await request("q1", "/unknown/media", 0)).status, 403);
    assert.equal((await request("q1", "/two/media", 4)).status, 403);
    // A live teammate subscription receives the copied unlock without an HTTP content refresh.
    let stopOpened = () => {};
    const teammateUnlock = new Promise<void>((resolve, reject) => {
      stopOpened = onSnapshot(query(collection(clients[2].firestoreClient, `${ledgerPath}/openedClues`), where("questionId", "==", "q1")), (snapshot) => {
        if (snapshot.docs.some((item) => item.data().content.text === "secret-q1-two")) resolve();
      }, reject);
    });
    assert.equal((await request("q1", "/two/media")).status, 403);
    for (const id of ["audio", "video"]) {
      assert.equal((await request("q1", `/${id}/media`)).status, 403);
      assert.equal((await request("q1", `/${id}/media`, 0)).status, 200);
    }
    assert.equal((await buy("q2", "two")).status, 409, "Only the presented question can sell clues");
    assert.equal((await buy("q1", "two", 3)).status, 409, "Stale team identity cannot charge another team");
    const duplicate = await Promise.all([buy("q1", "two"), buy("q1", "two", 2)]);
    assert.ok(duplicate.every((result) => result.status === 200 && result.data.remainingCoins === 3));
    await teammateUnlock; stopOpened();
    assert.equal((await opened("q1", 2))[0].content.text, "secret-q1-two");
    assert.equal((await request("q1", "/two/media")).data, "private-image");
    assert.equal((await request("q1", "/two/media", 3)).status, 403);
    async function present(question: string, revealedClueIds: string[] = [], withAnswer = false) {
      const next = { ...current, question, revealedClueIds, withAnswer };
      await transitionPresentation(db, roomId, users[0].uid, current, next); current = next;
    }
    await present("q2");
    assert.equal(await ledger(), 3);
    assert.equal(await ledger(3), 5);
    assert.equal((await buy("q2", "four")).status, 409);
    assert.equal(await ledger(), 3);
    assert.deepEqual(await opened("q2"), []);
    assert.equal((await buy("q2", "three")).data.remainingCoins, 0, "Last coins open a clue on the first request");
    assert.equal((await opened("q1"))[0].content.text, "secret-q1-two", "Reconnecting/returning preserves purchases");
    assert.deepEqual(await opened("q1", 3), []);
    // Different purchases contend on a single team/round balance.
    const concurrent = await Promise.all([buy("q2", "three", 3, "blue"), buy("q2", "four", 3, "blue")]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    const blueBalance = await ledger(3); assert.ok(blueBalance === 1 || blueBalance === 2);
    await assert.rejects(present("q2", ["two"]), /closed clues round/);
    // Real SDK rules: no ledger forgery, cross-team reads, definition reads, or direct image access.
    for (const index of [0, 1, 2, 3]) {
      await denied(setDoc(doc(clients[index].firestoreClient, ledgerPath), { remainingCoins: 999 }));
      await denied(setDoc(doc(clients[index].firestoreClient, `${ledgerPath}/openedClues/q2:four`), { text: "forged" }));
      for (const path of [imagePath, audioPath, videoPath]) {
        await denied(getBytes(ref(clients[index].storageClient, path)));
        await denied(uploadBytes(ref(clients[index].storageClient, path), new Uint8Array([1])));
      }
    }
    await denied(getDocFromServer(doc(clients[3].firestoreClient, ledgerPath)));
    assert.equal((await getDocFromServer(doc(clients[2].firestoreClient, ledgerPath))).data()?.remainingCoins, 0);
    await denied(getDocFromServer(doc(clients[1].firestoreClient, `${round.path}/questions/q2/clues/two`)));
    const answerPath = `${round.path}/answers/q2`;
    await denied(getDocFromServer(doc(clients[1].firestoreClient, answerPath)));
    // Freeze submissions and verify purchases/reveals do not alter frozen answers or charge coins.
    for (const team of ["red", "blue"]) await room.collection("teams").doc(team).collection("rounds").doc("r1").collection("answers").doc("q2").set({ answer: "Paris", locked: true, user: users[1].uid });
    const closed = { ...current, question: null, revealedClueIds: [] };
    await transitionPresentation(db, roomId, users[0].uid, current, closed, { closeRound: "r1" }); current = closed;
    assert.equal((await buy("q2", "two")).status, 409);
    assert.equal((await buy("q1", "two")).status, 200, "Acknowledging an existing purchase after closure is free");
    await present("q2");
    await denied(getDocFromServer(doc(clients[1].firestoreClient, answerPath)));
    await present("q2", ["two"]);
    assert.equal((await definition("q2", "two", 3)).data()?.content.text, "secret-q2-two");
    await denied(definition("q2", "three"));
    await denied(definition("q1", "two", 3));
    await denied(definition("q2", "two", 4));
    await denied(getDocsFromServer(collection(clients[3].firestoreClient, `${round.path}/questions/q2/clues`)));
    await denied(setDoc(doc(clients[3].firestoreClient, `${round.path}/questions/q2/clues/two`), { content: { text: "forged" } }));
    assert.equal((await request("q2", "/two/media", 3)).status, 200);
    assert.equal(await ledger(), 0);
    await present("q2");
    await denied(definition("q2", "two", 3));
    assert.equal((await request("q2", "/two/media", 3)).status, 403);
    assert.equal((await opened("q2"))[0].content.text, "secret-q2-three", "Hiding preserves purchased clues");
    await assert.rejects(present("q2", ["unknown"]), /Unknown clue/);
    await present("q2", ["audio", "video"]);
    for (const [id, type] of [["audio", "audio/mpeg"], ["video", "video/webm"]]) {
      const result = await request("q2", `/${id}/media`, 3);
      assert.equal(result.status, 200);
      assert.equal(result.data, `private-${id}`);
      assert.equal(result.response.headers.get("content-type"), type);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
    }
    await present("q2");
    assert.equal((await request("q2", "/audio/media", 3)).status, 403);
    await present("q2", clues.map((clue) => clue.id), true);
    assert.equal((await getDocFromServer(doc(clients[1].firestoreClient, answerPath))).data()?.hint, "Paris");
    await present("q1");
    await denied(getDocFromServer(doc(clients[1].firestoreClient, answerPath)));
    await denied(definition("q2", "two", 3)); // Navigation resets public reveals.
    for (const team of ["red", "blue"]) assert.equal((await round.collection("teamAnswers").doc(team).collection("answers").doc("q2").get()).data()?.answer, "Paris");
    // Navigation can overlap purchases on different questions; the round budget stays shared.
    const raceRound = room.collection("rounds").doc("race");
    await raceRound.set({ type: "clues", state: "active", startingCoins: 5 });
    await room.collection("teams").doc("race-team").set({ name: "Race" });
    for (const index of [1, 2]) await room.collection("members").doc(users[index].uid).update({ team: "race-team" });
    for (const question of ["q1", "q2"]) {
      await raceRound.collection("questions").doc(question).set({ stages: [{ text: question }], clues: [clues[2]] });
      await raceRound.collection("questions").doc(question).collection("clues").doc("four").set({ price: 4, content: { text: "Race clue", media: null } });
    }
    const before = { ...current, round: "race", question: "q1", withAnswer: false, revealedClueIds: [] };
    await room.update({ presenting: before });
    const after = { ...before, question: "q2" };
    const race = await Promise.allSettled([
      purchaseClue(db, roomId, "race", "q1", "four", users[1].uid, "race-team"),
      transitionPresentation(db, roomId, users[0].uid, before, after),
      purchaseClue(db, roomId, "race", "q2", "four", users[2].uid, "race-team"),
    ]);
    assert.equal(race[1].status, "fulfilled");
    const successes = [race[0], race[2]].filter((result) => result.status === "fulfilled").length;
    assert.ok(successes <= 1, "Concurrent purchases across questions cannot overspend");
    for (const result of [race[0], race[2]]) if (result.status === "rejected") assert.equal(result.reason.status, 409);
    const raceBalance = (await db.doc(clueLedgerPath(roomId, "race-team", "race")).get()).data()?.remainingCoins ?? 5;
    assert.equal(raceBalance, 5 - successes * 4);
    console.log("Verified clue HTTP purchases, last-coin spending, concurrent transactions, team isolation, Firestore/Storage rules, private images, closure, and host reveals.");
  } finally {
    if (server && server.exitCode === null) { const stopped = new Promise<void>((resolve) => server!.once("exit", () => resolve())); server.kill("SIGTERM"); await stopped; }
    await Promise.all(clients.map(async (client) => { await terminate(client.firestoreClient); await deleteClient(client.app); }));
    await db.recursiveDelete(room); await Promise.all([imagePath, audioPath, videoPath].map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await Promise.all(users.map((user) => adminAuth.deleteUser(user.uid))); await db.terminate(); await deleteApp(app);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
