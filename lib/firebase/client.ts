"use client";

import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import { getApp, getApps, initializeApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import { getFirestore } from "firebase/firestore";

const firebaseClientConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let cachedClientApp: FirebaseApp | undefined;

function ensureClientConfig() {
  const required = [
    ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseClientConfig.apiKey],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseClientConfig.authDomain],
    ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseClientConfig.projectId],
    ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseClientConfig.appId],
  ];

  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(
      `Missing Firebase client configuration. Set ${missing.join(", ")}`
    );
  }
}

export function getFirebaseClientApp(): FirebaseApp {
  if (cachedClientApp) {
    return cachedClientApp;
  }

  ensureClientConfig();

  cachedClientApp = getApps().length ? getApp() : initializeApp(firebaseClientConfig);
  return cachedClientApp;
}

export function getClientFirestore(): Firestore {
  return getFirestore(getFirebaseClientApp());
}
