import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp as initializeClient, deleteApp as deleteClient } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, onSnapshot, terminate } from "firebase/firestore";
import { applySortingEdit, type SortingEdit } from "@/types/sorting";
import { transitionPresentation, type Presentation } from "./presentation";
import { gradeSortingRound, scoreSortingOrder } from "./sorting";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApp(port: number, projectId: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, QUIZEE_NEXT_DIST_DIR: ".next", FIREBASE_PROJECT_ID: projectId,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId, NEXT_PUBLIC_FIREBASE_API_KEY: "fake",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_APP_ID: "sorting-http-test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Next server did not become ready: ${output}`)); }, 30000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Next exited before readiness (${code}): ${output}`)); });
    const receive = (chunk: Buffer) => {
      output = `${output}${chunk}`.slice(-6000);
      if (output.includes("Ready in")) { clearTimeout(timeout); resolve(); }
    };
    child.stdout!.on("data", receive); child.stderr!.on("data", receive);
  });
  return child;
}

async function main() {
  const firestoreAddress = process.env.FIRESTORE_EMULATOR_HOST;
  const authAddress = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!firestoreAddress || !authAddress || ![firestoreAddress, authAddress].every((address) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(`http://${address}`).hostname))) {
    throw new Error("Sorting HTTP tests require local Firestore and Auth emulators.");
  }
  const projectId = "demo-quizee-drafts";
  const adminApp = initializeApp({ projectId }, "sorting-http-admin");
  const db = getAdminFirestore(adminApp), adminAuth = getAdminAuth(adminApp);
  const clients = ["a", "b"].map((name) => {
    const app = initializeClient({ projectId, apiKey: "fake" }, `sorting-http-${name}`);
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${authAddress}`, { disableWarnings: true });
    const firestore = getFirestore(app);
    const location = new URL(`http://${firestoreAddress}`);
    connectFirestoreEmulator(firestore, location.hostname, Number(location.port));
    return { app, auth, firestore };
  });
  const roomId = `sorting-http-${randomUUID()}`;
  const room = db.collection("rooms").doc(roomId), round = room.collection("rounds").doc("sorting");
  const current: Presentation = { round: null, question: null, withAnswer: false, promptPage: 0, answerPage: 0 };
  const accounts: string[] = [];
  let server: ChildProcess | null = null;
  let unsubscribe = () => {};
  try {
    const users = await Promise.all(clients.map(async ({ auth }) => (await signInAnonymously(auth)).user));
    accounts.push(...users.map((user) => user.uid));
    const tokens = await Promise.all(users.map((user) => user.getIdToken()));
    const batch = db.batch();
    batch.set(room, { state: "playing", presenting: current });
    batch.set(room.collection("members").doc("host"), { role: "host", team: null });
    for (const user of users) batch.set(room.collection("members").doc(user.uid), { role: "player", team: "red" });
    for (const team of ["red", "blue"]) batch.set(room.collection("teams").doc(team), { name: team });
    batch.set(round, { type: "sorting", state: "scheduled", gradingRequired: false });
    batch.set(round.collection("questions").doc("question-1"), { order: 0, text: "Sort", items: ["a", "b", "c", "d"].map((id) => ({ id, stages: [{ text: id }] })) });
    batch.set(round.collection("answers").doc("question-1"), { correctOrder: ["a", "b", "c", "d"] });
    await batch.commit();
    await transitionPresentation(db, roomId, "host", current, current, { activateRound: "sorting" });
    const live = room.collection("teams").doc("red").collection("rounds").doc("sorting").collection("answers").doc("question-1");
    const initial = (await live.get()).data()!.order as string[];
    const observations = new Map<number, { order: string[]; at: number }>();
    const waiters = new Map<number, () => void>();
    unsubscribe = onSnapshot(doc(clients[1].firestore, live.path), (snapshot) => {
      if (snapshot.metadata.fromCache || !snapshot.exists()) return;
      const data = snapshot.data(); observations.set(data.revision, { order: data.order, at: performance.now() });
      waiters.get(data.revision)?.();
    });
    const observed = (revision: number) => observations.has(revision) ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Teammate did not observe revision ${revision}.`)), 10000);
      waiters.set(revision, () => { clearTimeout(timer); waiters.delete(revision); resolve(); });
    });
    await observed(0);
    const port = await availablePort(); server = await startApp(port, projectId);
    const endpoint = `http://127.0.0.1:${port}/api/rooms/${roomId}/rounds/sorting/answers/question-1`;
    const request = async (edit: SortingEdit, token = tokens[0]) => {
      const startedAt = performance.now();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId: "red", edit }) });
      return { response, payload: await response.json() as { editId?: string; revision?: number; code?: string }, startedAt, responseMs: performance.now() - startedAt };
    };
    const edits: SortingEdit[] = [
      { id: randomUUID(), itemId: initial[0], anchorId: initial[2], placement: "after" },
      { id: randomUUID(), itemId: initial[3], anchorId: initial[1], placement: "before" },
    ];
    const results = await Promise.all(edits.map((edit, index) => request(edit, tokens[index])));
    for (const result of results) {
      assert.equal(result.response.status, 200);
      assert.match(result.response.headers.get("Server-Timing") ?? "", /auth;dur=[\d.]+, save;dur=[\d.]+/);
      assert.ok(Number.isSafeInteger(result.payload.revision));
    }
    await observed(2);
    const orderedEdits = results.map((result, index) => ({ revision: result.payload.revision!, edit: edits[index] })).sort((a, b) => a.revision - b.revision);
    assert.deepEqual(observations.get(2)!.order, orderedEdits.reduce((order, { edit }) => applySortingEdit(order, edit), initial));
    const warm = await request({ id: randomUUID(), itemId: initial[0], anchorId: initial[3], placement: "after" });
    assert.equal(warm.response.status, 200);
    assert.equal(warm.payload.revision, 3);
    await observed(3);
    const repeated = await request(edits[0]);
    assert.deepEqual(repeated.payload, results[0].payload);
    assert.equal((await live.get()).data()!.revision, 3);
    await transitionPresentation(db, roomId, "host", current, current, { closeRound: "sorting" });
    assert.deepEqual((await request(edits[0])).payload, results[0].payload);
    const refused = await request({ ...edits[0], id: randomUUID() });
    assert.equal(refused.response.status, 409); assert.equal(refused.payload.code, "round-closed");
    await gradeSortingRound(db, roomId, "sorting", "host");
    const untouched = (await round.collection("teamAnswers").doc("blue").collection("answers").doc("question-1").get()).data()!;
    assert.deepEqual(JSON.parse(untouched.answer), initial);
    assert.equal(untouched.awardedPoints, scoreSortingOrder(initial, ["a", "b", "c", "d"]));
    console.log(JSON.stringify({ event: "sorting.http-emulator-timing", samples: [...results, warm].map((result, index) => ({
      phase: index < 2 ? "cold-concurrent" : "warm-single",
      requestMs: Math.round(result.responseMs), serverTiming: result.response.headers.get("Server-Timing"),
      teammateSnapshotMs: Math.round(Math.min(...[...observations].filter(([revision]) => revision >= result.payload.revision!).map(([, observation]) => observation.at)) - result.startedAt),
    })), note: "Local emulators and built Next server; these are not production latency measurements." }));
    console.log("Verified authenticated HTTP edits, concurrent teammate merging, duplicate acknowledgements, initial-order scoring, and closed-round rejection.");
  } finally {
    unsubscribe();
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
