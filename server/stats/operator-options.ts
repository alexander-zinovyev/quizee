import { parseArgs } from "node:util";

export function statsOperatorOptions(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    actor: { type: "string" }, project: { type: "string" }, game: { type: "string" }, person: { type: "string" },
    after: { type: "string" }, limit: { type: "string" }, cutoff: { type: "string" }, "expected-version": { type: "string" },
    apply: { type: "boolean", default: false }, all: { type: "boolean" },
  } });
  const command = positionals[0];
  if (positionals.length !== 1 || !["rebuild", "person", "integrity", "metrics", "cleanup-snapshots", "cleanup-audit"].includes(command)) throw new Error("Choose rebuild, person, integrity, metrics, cleanup-snapshots, or cleanup-audit.");
  if (!values.actor || !values.project) throw new Error("Explicit --actor <admin-uid> and --project <firebase-project-id> are required.");
  const allowed = new Set(["actor", "project", "apply", ...(["integrity", "metrics", "cleanup-snapshots", "cleanup-audit"].includes(command) ? ["after", "limit", "all"] : []),
    ...(command === "rebuild" ? ["game", "expected-version"] : []), ...(command === "person" ? ["person", "expected-version"] : []),
    ...(command.startsWith("cleanup-") ? ["cutoff"] : [])]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error(`Unsupported --${key} for ${command}.`);
  if ((command === "rebuild" && !values.game) || (command === "person" && !values.person)) throw new Error("Specify the target --game or --person.");
  if (command.startsWith("cleanup-") && !values.cutoff) throw new Error("Cleanup requires an explicit --cutoff <UTC timestamp>. No retention period is assumed.");
  if (command === "integrity" && values.apply) throw new Error("Integrity scans never repair automatically. Review each diff and use rebuild or person with --apply.");
  if (command === "metrics" && values.apply) throw new Error("Metrics reporting is read-only.");
  const expectedVersion = values["expected-version"] === undefined ? undefined : Number(values["expected-version"]);
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) throw new Error("--expected-version must be a nonnegative integer.");
  if (values.apply && ["rebuild", "person"].includes(command) && expectedVersion === undefined) throw new Error("Run the dry-run first, then pass its --expected-version when applying.");
  const limit = values.limit === undefined ? 25 : Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be between 1 and 100.");
  return { command, actor: values.actor, project: values.project, game: values.game, person: values.person, after: values.after,
    cutoff: values.cutoff, apply: values.apply, all: values.all ?? false, limit, expectedVersion };
}
