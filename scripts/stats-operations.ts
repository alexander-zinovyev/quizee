import { config } from "dotenv";
import { getServerFirestore } from "../server/database";
import { statsOperatorOptions } from "../server/stats/operator-options";
import { checkStatsIntegrity, cleanupStatsAudit, cleanupStatsSnapshots, rebuildStatsGame, reconcileStatsPerson, statsHealth } from "../server/stats/operations";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const options = statsOperatorOptions(process.argv.slice(2));
  if (process.env.FIREBASE_PROJECT_ID !== options.project) throw new Error("--project must exactly match FIREBASE_PROJECT_ID. Check the configured credentials before continuing.");
  const db = getServerFirestore(), started = performance.now();
  let after = options.after, drift = false;
  const health = { publishedGames: 0, fullyMappedGames: 0, reviewDurationTotalMs: 0, reviewDurationSamples: 0 };
  try {
    do {
      const pageOptions = { ...options, after };
      const result = options.command === "rebuild" ? await rebuildStatsGame(db, options.actor, options.game!, options)
        : options.command === "person" ? await reconcileStatsPerson(db, options.actor, options.person!, options)
        : options.command === "integrity" ? await checkStatsIntegrity(db, options.actor, pageOptions)
        : options.command === "metrics" ? await statsHealth(db, options.actor, pageOptions)
        : options.command === "cleanup-snapshots" ? await cleanupStatsSnapshots(db, options.actor, { ...pageOptions, cutoff: options.cutoff! })
        : await cleanupStatsAudit(db, options.actor, { ...pageOptions, cutoff: options.cutoff! });
      console.log(JSON.stringify({ operation: options.command, project: options.project, mode: options.apply ? "apply" : "dry-run", ...result }));
      if (options.command === "integrity" && "results" in result) drift ||= result.results.some((row) => "changed" in row && row.changed);
      if (options.command === "metrics" && "publishedGames" in result) for (const key of Object.keys(health) as Array<keyof typeof health>) health[key] += result[key];
      after = "nextAfter" in result ? result.nextAfter ?? undefined : undefined;
    } while (options.all && after);
    console.log(JSON.stringify({ operation: options.command, elapsedMs: Math.round(performance.now() - started), complete: !after, ...(after ? { nextAfter: after } : {}), drift,
      ...(options.command === "metrics" ? { ...health, fullyMappedShare: health.publishedGames ? health.fullyMappedGames / health.publishedGames : null, averageReviewDurationMs: health.reviewDurationSamples ? health.reviewDurationTotalMs / health.reviewDurationSamples : null } : {}) }));
    if (drift) process.exitCode = 2;
  } finally { await db.terminate(); }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Statistics operation failed."); process.exitCode = 1; });
