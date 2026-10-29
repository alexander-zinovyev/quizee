import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp as initializeClient, deleteApp as deleteClient } from "firebase/app";
import { connectAuthEmulator, getAuth as getClientAuth, GoogleAuthProvider, signInAnonymously, signInWithCredential, signOut } from "firebase/auth";
import { bootstrapStatsAdmin, lookupAdminUsers, setAdminRole } from "./roles";
import { establishAdminSession, requireStatsSessionAdmin, statsSessionUser } from "./sessions";
import { STATS_ROOT } from "./model";

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Authentication tests require both Firestore and Auth emulators.");
  const projectId = "demo-quizee-drafts";
  const app = initializeApp({ projectId }, "stats-auth");
  const db = getFirestore(app), auth = getAuth(app);
  const apps = ["gameplay", "admin-a", "admin-b"].map((name) => {
    const app = initializeClient({ projectId, apiKey: "fake" }, `stats-auth-${name}`);
    const client = getClientAuth(app);
    connectAuthEmulator(client, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    return { app, auth: client };
  });
  const accounts: string[] = [];
  try {
    const [gameplay, first, second] = apps;
    const anonymous = (await signInAnonymously(gameplay.auth)).user;
    accounts.push(anonymous.uid);
    const credential = (sub: string) => GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true, name: sub }));
    const a = (await signInWithCredential(first.auth, credential("admin-a"))).user;
    const b = (await signInWithCredential(second.auth, credential("admin-b"))).user;
    accounts.push(a.uid, b.uid);
    const cookieA = await establishAdminSession(auth, db, await a.getIdToken());
    const cookieB = await establishAdminSession(auth, db, await b.getIdToken());
    assert.equal((await statsSessionUser(auth, db, cookieA)).admin, false);
    await assert.rejects(requireStatsSessionAdmin(auth, db, cookieA));
    await assert.rejects(establishAdminSession(auth, db, await anonymous.getIdToken()));
    await bootstrapStatsAdmin(db, auth, a.uid);
    await assert.rejects(bootstrapStatsAdmin(db, auth, b.uid), /already run/);
    assert.equal(await requireStatsSessionAdmin(auth, db, cookieA), a.uid);
    const directory = await lookupAdminUsers(db, a.uid, "admin-b@example.com");
    assert.equal(directory[0].uid, b.uid);
    assert.equal(directory[0].roleVersion, 0);
    await assert.rejects(setAdminRole(db, a.uid, a.uid, false, 1), /last administrator/);
    await setAdminRole(db, a.uid, b.uid, true, 0);
    assert.equal(await requireStatsSessionAdmin(auth, db, cookieB), b.uid);
    const historyCount = async () => (await db.collection(`${STATS_ROOT}/audit`).where("action", "==", "grant-admin").get()).size;
    const count = await historyCount();
    await setAdminRole(db, a.uid, b.uid, true, 0);
    assert.equal(await historyCount(), count, "A repeated grant cannot create a second audit event.");
    await assert.rejects(setAdminRole(db, a.uid, b.uid, false, 0), /role changed/);
    await setAdminRole(db, a.uid, b.uid, false, 1);
    await assert.rejects(requireStatsSessionAdmin(auth, db, cookieB), /not been granted/);
    await setAdminRole(db, a.uid, b.uid, true, 2);
    const competing = await Promise.allSettled([setAdminRole(db, a.uid, a.uid, false, 1), setAdminRole(db, b.uid, b.uid, false, 3)]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await db.doc("roles/_state").get()).data()!.adminCount, 1);
    assert.equal((await db.collection("roles").where("admin", "==", true).get()).size, 1);
    await signOut(first.auth); await signOut(second.auth);
    assert.equal(gameplay.auth.currentUser?.uid, anonymous.uid, "Administrator login/logout must preserve gameplay's anonymous UID.");
    console.log("Verified real emulator Google sessions, anonymous-auth isolation, first-admin bootstrap, immediate revocation, idempotency, and competing last-admin revocations.");
  } finally {
    for (const uid of accounts) {
      await db.doc(`roles/${uid}`).delete(); await db.doc(`users/${uid}`).delete();
      await auth.deleteUser(uid);
    }
    await db.doc("roles/_state").delete();
    const history = await db.collection(`${STATS_ROOT}/audit`).get();
    const cleanup = db.batch(); history.docs.forEach((event) => cleanup.delete(event.ref)); await cleanup.commit();
    await Promise.all(apps.map(({ app }) => deleteClient(app)));
    await db.terminate(); await deleteApp(app);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
