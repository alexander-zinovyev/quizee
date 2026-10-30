import { StatsError } from "./error";

export type StatsWrite = { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData | null };

/** Conservative JSON limits leave room for Firestore's document and request encoding. */
export function assertWriteBudget(writes: StatsWrite[]) {
  const sizes = writes.map(({ ref, data }) => Buffer.byteLength(JSON.stringify({ path: ref.path, data }), "utf8"));
  const jsonBytes = sizes.reduce((total, size) => total + size, 0);
  if (sizes.some((size) => size > 768 * 1024) || jsonBytes > 4 * 1024 * 1024) {
    throw new StatsError("atomic-budget-exceeded", "This change exceeds the validated atomic statistics write budget.", 422);
  }
  return { documents: writes.length, jsonBytes };
}
