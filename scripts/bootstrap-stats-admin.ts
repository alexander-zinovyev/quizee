import { config } from "dotenv";
import { getServerAuth, getServerFirestore } from "../server/database";
import { bootstrapStatsAdmin } from "../server/stats/roles";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const uid = process.argv[2];
  if (!uid || process.argv.length !== 3) throw new Error("Usage: node --import tsx scripts/bootstrap-stats-admin.ts <existing-google-uid>");
  const result = await bootstrapStatsAdmin(getServerFirestore(), getServerAuth(), uid);
  console.log(`Bootstrapped the first statistics administrator: ${result.uid}`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Bootstrap failed."); process.exitCode = 1; });
