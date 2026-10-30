import assert from "node:assert/strict";
import { StatsError } from "./error";
import { statsOperation } from "./telemetry";

async function main() {
  const info = console.info, error = console.error, logs: unknown[][] = [];
  console.info = (...args: unknown[]) => { logs.push(args); }; console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const result = await statsOperation("test", { gameId: "saved-game" }, async () => ({ version: 2, snapshotId: "saved-copy", notes: "PRIVATE", answer: "PRIVATE", token: "PRIVATE" }));
    assert.equal(result.notes, "PRIVATE", "Logging must not change the domain result.");
    await assert.rejects(statsOperation("test", {}, async () => { throw new StatsError("stale-version", "PRIVATE", 409, { note: "PRIVATE" }); }));
    const serialized = JSON.stringify(logs);
    assert.ok(serialized.includes("saved-copy")); assert.ok(serialized.includes("stale-version")); assert.ok(!serialized.includes("PRIVATE"));
  } finally { console.info = info; console.error = error; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
