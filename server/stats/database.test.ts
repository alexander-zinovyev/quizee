import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getServerAuth, getServerFirestore, getServerStorageBucket } from "@/server/database";

async function main() {
  const keys = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"];
  const previous = keys.map((key) => process.env[key]);
  let db: ReturnType<typeof getServerFirestore> | undefined;
  try {
    process.env.FIREBASE_PROJECT_ID = "real-project";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:1";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:1";
    delete process.env.FIREBASE_CLIENT_EMAIL; delete process.env.FIREBASE_PRIVATE_KEY;
    assert.throws(() => getServerFirestore(), /demo-/);
    process.env.FIREBASE_PROJECT_ID = "demo-quizee-drafts";
    initializeApp({ projectId: "demo-quizee-drafts" }, "server-named-first");
    db = getServerFirestore();
    assert.equal(getServerFirestore(), db);
    assert.equal(getServerAuth().app.name, "[DEFAULT]");
    assert.equal(getServerAuth().app.options.projectId, "demo-quizee-drafts");
    assert.throws(() => getServerStorageBucket(), /Storage emulator/);
  } finally {
    if (db) await db.terminate();
    await Promise.all(getApps().map((app) => deleteApp(app)));
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
