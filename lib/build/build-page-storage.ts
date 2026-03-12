const DB_NAME = "quizee-build";
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "build-page";
const SNAPSHOT_VERSION = 1;

export const BUILD_SNAPSHOT_TTL_MS = 30 * 60 * 1000;

type BuildSnapshotPayload = {
  rounds: unknown;
  mediaTreeState: unknown;
};

type StoredBuildSnapshot = BuildSnapshotPayload & {
  version: number;
  savedAt: number;
  expiresAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function readSnapshot(): Promise<StoredBuildSnapshot | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SNAPSHOT_KEY);

    request.onsuccess = () => {
      resolve((request.result as StoredBuildSnapshot | undefined) ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to read build snapshot"));
    transaction.oncomplete = () => db.close();
  });
}

export async function clearBuildSnapshot(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(SNAPSHOT_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to clear build snapshot"));
    transaction.oncomplete = () => db.close();
  });
}

export async function loadBuildSnapshot(): Promise<BuildSnapshotPayload | null> {
  const snapshot = await readSnapshot();
  if (!snapshot) return null;

  if (snapshot.version !== SNAPSHOT_VERSION || Date.now() > snapshot.expiresAt) {
    await clearBuildSnapshot();
    return null;
  }

  return {
    rounds: snapshot.rounds,
    mediaTreeState: snapshot.mediaTreeState,
  };
}

export async function saveBuildSnapshot(payload: BuildSnapshotPayload): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  const snapshot: StoredBuildSnapshot = {
    version: SNAPSHOT_VERSION,
    savedAt: now,
    expiresAt: now + BUILD_SNAPSHOT_TTL_MS,
    rounds: payload.rounds,
    mediaTreeState: payload.mediaTreeState,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(snapshot, SNAPSHOT_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to save build snapshot"));
    transaction.oncomplete = () => db.close();
  });
}
