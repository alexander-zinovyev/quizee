import { gzipSync, gunzipSync } from "node:zlib";
import type { Firestore } from "firebase-admin/firestore";

export type StatsReadCache = { read<T extends object>(key: string[], load: () => Promise<T>): Promise<T> };
type PackedValue = { payload: string | null };
type PackedReader = (key: string[], load: () => Promise<PackedValue>) => Promise<PackedValue>;
const caches = new WeakMap<Firestore, { cache: StatsReadCache; projectId: string }>();

/** Only immutable snapshots and versioned derived data belong here, never authorization. */
export function configureStatsReadCache(db: Firestore, cache: StatsReadCache, projectId: string) { caches.set(db, { cache, projectId }); }

export async function cacheStatsRead<T extends object>(db: Firestore, key: string[], load: () => Promise<T>): Promise<T> {
  const configured = caches.get(db);
  if (!configured) return load(); // Operator tools and ordinary SDK callers remain uncached.
  let loaded = false;
  const value = await configured.cache.read(["stats-read-v1", process.env.VERCEL_GIT_COMMIT_SHA ?? "local", configured.projectId, db.databaseId, process.env.FIRESTORE_EMULATOR_HOST ?? "production", ...key], async () => {
    loaded = true;
    return load();
  });
  console.info(JSON.stringify({ event: "stats.cache-read", scope: key[0], result: loaded ? "load" : "hit" }));
  return structuredClone(value);
}

/** Keep entries below the shared cache's item limit without limiting supported game sizes. */
export function createStatsReadCache(readPacked: PackedReader): StatsReadCache {
  return { async read<T extends object>(key: string[], load: () => Promise<T>): Promise<T> {
    let fresh: T | undefined;
    const packed = await readPacked(key, async () => {
      fresh = await load();
      const payload = gzipSync(JSON.stringify(fresh)).toString("base64");
      return { payload: Buffer.byteLength(payload) <= 1024 * 1024 ? payload : null };
    });
    // Oversized values stay supported but deliberately bypass payload caching.
    if (packed.payload === null) return fresh ?? load();
    return JSON.parse(gunzipSync(Buffer.from(packed.payload, "base64")).toString("utf8")) as T;
  } };
}

export function documentCacheVersion(document: FirebaseFirestore.DocumentSnapshot): string {
  return `${document.updateTime!.seconds}.${document.updateTime!.nanoseconds}`;
}
