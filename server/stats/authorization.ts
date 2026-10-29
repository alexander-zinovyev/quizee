import type { Firestore, Transaction } from "firebase-admin/firestore";
import { StatsError } from "./error";
import { statsId } from "./model";

/** Call within every mutation transaction so concurrent revocation cannot authorize a new write. */
export async function assertStatsAdmin(tx: Transaction, db: Firestore, actorId: string): Promise<void> {
  if (actorId === "_state") throw new StatsError("forbidden", "Administrator access is required.", 403);
  const role = await tx.get(db.collection("roles").doc(statsId(actorId)));
  if (role.data()?.admin !== true) throw new StatsError("forbidden", "Administrator access is required.", 403);
}
