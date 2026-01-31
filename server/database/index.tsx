import type { App } from "firebase-admin/app";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";
import { getStorage } from "firebase-admin/storage";

let firebaseAdminApp: App | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let firestoreSettingsApplied = false;
let storageBucket: Bucket | undefined;

function initFirebaseAdmin(): App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase admin credentials. Ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are set."
    );
  }

  firebaseAdminApp =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });

  return firebaseAdminApp;
}

export function getServerFirestore(): Firestore {
  if (firestore) {
    return firestore;
  }

  firestore = getFirestore(initFirebaseAdmin());
  if (!firestoreSettingsApplied) {
    try {
      // Apply settings only once; Firestore freezes settings after first use.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settingsFrozen = (firestore as any)?._settingsFrozen;
      if (!settingsFrozen) {
        firestore.settings({ ignoreUndefinedProperties: true });
      }
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (!message.includes("already been initialized")) {
        throw error;
      }
    } finally {
      firestoreSettingsApplied = true;
    }
  }

  return firestore;
}

export function getServerAuth(): Auth {
  if (auth) {
    return auth;
  }

  auth = getAuth(initFirebaseAdmin());
  return auth;
}

export function getServerStorageBucket(): Bucket {
  if (storageBucket) {
    return storageBucket;
  }

  const app = initFirebaseAdmin();
  const explicitBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const bucketName =
    explicitBucket || (projectId ? `${projectId}.appspot.com` : undefined);

  if (!bucketName) {
    throw new Error(
      "Missing storage bucket name. Set FIREBASE_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET."
    );
  }

  storageBucket = getStorage(app).bucket(bucketName);
  return storageBucket;
}
