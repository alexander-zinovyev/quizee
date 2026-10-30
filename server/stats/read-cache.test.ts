import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { cacheStatsRead, configureStatsReadCache } from "./read-cache";
import { statsCacheFixture } from "./read-cache.fixtures";

const database = (projectId = "demo-cache") => ({ projectId, databaseId: "(default)" }) as unknown as Firestore;

test("shared cache survives worker changes, isolates databases/versions and returns independent objects", async () => {
  const shared = statsCacheFixture(), first = database(), second = database(), other = database("demo-other");
  for (const db of [first, second, other]) configureStatsReadCache(db, shared.adapter, (db as unknown as { projectId: string }).projectId);
  let reads = 0;
  const load = async () => { reads++; return { title: "Квіз", scores: [0, -2, 0.5] }; };
  const original = await cacheStatsRead(first, ["snapshot", "s1"], load);
  original.scores[0] = 999;
  assert.deepEqual((await cacheStatsRead(second, ["snapshot", "s1"], load)).scores, [0, -2, 0.5]);
  assert.equal(reads, 1);
  await cacheStatsRead(second, ["snapshot", "s2"], load);
  await cacheStatsRead(other, ["snapshot", "s1"], load);
  assert.equal(reads, 3);
});

test("failed loads are not cached and oversized payloads remain readable without cache-size failures", async () => {
  const shared = statsCacheFixture(), db = database(); configureStatsReadCache(db, shared.adapter, (db as unknown as { projectId: string }).projectId);
  await assert.rejects(cacheStatsRead(db, ["failed"], async () => { throw new Error("interrupted copy"); }));
  assert.equal(shared.values.size, 0);
  let reads = 0;
  const large = { text: randomBytes(1200000).toString("base64") };
  const load = async () => { reads++; return large; };
  assert.deepEqual(await cacheStatsRead(db, ["large"], load), large);
  assert.deepEqual(await cacheStatsRead(db, ["large"], load), large);
  assert.equal(reads, 2);
});
