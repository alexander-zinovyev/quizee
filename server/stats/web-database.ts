import { unstable_cache } from "next/cache";
import { getServerFirestore } from "@/server/database";
import { configureStatsReadCache, createStatsReadCache } from "./read-cache";

const cache = createStatsReadCache((key, load) => unstable_cache(load, key, { revalidate: false })());

/** Shared across web requests/instances. All access checks still happen before cache lookup. */
export function getStatsFirestore() {
  const db = getServerFirestore();
  configureStatsReadCache(db, cache, process.env.FIREBASE_PROJECT_ID!);
  return db;
}
