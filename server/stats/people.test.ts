import assert from "node:assert/strict";
import test from "node:test";
import { newStatsPerson, verifyPersonCreation } from "./people";

const id = "97458e5f-460e-46dd-8aa8-50eb2fd72ead";
test("stable person creation IDs preserve ownership while names remain nonunique", () => {
  const first = newStatsPerson({ id, displayName: "  Ａlex  Smith ", helperAliases: ["Al", "Al"], notes: "Private" }, "actor");
  assert.equal(first.searchName, "alex smith");
  assert.deepEqual(first.helperAliases, ["Al"]);
  const repeated = newStatsPerson({ id, displayName: "Ａlex  Smith", helperAliases: ["Al"], notes: "Private" }, "actor");
  assert.doesNotThrow(() => verifyPersonCreation(first, repeated));
  assert.throws(() => verifyPersonCreation(first, { ...repeated, createdBy: "other-actor" }));
  assert.throws(() => verifyPersonCreation(first, newStatsPerson({ id, displayName: "Different person" }, "actor")));
  assert.doesNotThrow(() => newStatsPerson({ id: "9d2cc75c-e681-4b62-8ca1-d48cd722d12d", displayName: first.displayName }, "actor"));
  assert.equal(first.hasPlayerHistory, false);
  assert.equal(first.mappingCount, 0);
});

test("malformed person fields and unsupported creation metadata are refused", () => {
  for (const value of [null, { id: "not-a-uuid", displayName: "Alex" }, { id, displayName: "" },
    { id, displayName: "Alex", helperAliases: null }, { id, displayName: "Alex", notes: null },
    { id, displayName: "Alex", admin: true }]) assert.throws(() => newStatsPerson(value as Parameters<typeof newStatsPerson>[0], "actor"));
});
