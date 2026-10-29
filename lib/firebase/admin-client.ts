"use client";

import { getAuth } from "firebase/auth";
import { getFirebaseClientApp } from "./client";

export function getStatsAdminAuth() {
  return getAuth(getFirebaseClientApp("statistics-admin"));
}
