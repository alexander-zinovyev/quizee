import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase/app";

async function main() {
  Object.assign(process.env, { NEXT_PUBLIC_FIREBASE_API_KEY: "test", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-quizee", NEXT_PUBLIC_FIREBASE_APP_ID: "test" });
  const named = initializeApp({ projectId: "demo-quizee" }, "statistics-admin-first");
  try {
    const { getFirebaseClientApp } = await import("./client");
    const gameplay = getFirebaseClientApp();
    assert.equal(gameplay.name, "[DEFAULT]");
    assert.notEqual(gameplay, named);
    assert.equal(getFirebaseClientApp(), gameplay);
  } finally {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
