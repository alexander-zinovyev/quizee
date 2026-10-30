import { parseArgs } from "node:util";
import { config } from "dotenv";
import { getServerFirestore } from "../server/database";
import { assertStatsAdmin } from "../server/stats/authorization";
import { statisticsIndexProbes } from "../server/stats/index-probes";

config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const { values } = parseArgs({ options: { project: { type: "string" }, actor: { type: "string" } } });
  if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID || !values.actor) throw new Error("Explicit --project matching FIREBASE_PROJECT_ID and --actor <admin-uid> are required.");
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Production query verification cannot use the emulator.");
  const db = getServerFirestore();
  try {
    await db.runTransaction((tx) => assertStatsAdmin(tx, db, values.actor!), { readOnly: true });
    for (const probe of statisticsIndexProbes(db)) {
      const result = await probe.query.get(); console.log(JSON.stringify({ query: probe.label, status: "success", documents: result.size }));
    }
  } finally { await db.terminate(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Statistics query verification failed."); process.exitCode = 1; });
