import assert from "node:assert/strict";
import { indexKey, missingStatisticsIndexes, singleFieldKey } from "./index-deployment";

const desired = { collectionGroup: "games", queryScope: "COLLECTION", fields: [{ fieldPath: "published", order: "ASCENDING" }, { fieldPath: "date", order: "DESCENDING" }] };
const deployed = { ...desired, name: "projects/test/databases/(default)/collectionGroups/games/indexes/one", state: "READY", fields: [...desired.fields, { fieldPath: "__name__", order: "DESCENDING" }] };
assert.equal(indexKey(desired), indexKey(deployed));
assert.equal(missingStatisticsIndexes([desired], [deployed])[0].status, "ready");
assert.equal(missingStatisticsIndexes([desired], [{ ...deployed, state: "CREATING" }])[0].status, "pending");
assert.equal(missingStatisticsIndexes([desired], [{ ...deployed, name: deployed.name.replace("/games/", "/rooms/") }])[0].status, "missing");
assert.equal(singleFieldKey([{ order: "ASCENDING", queryScope: "COLLECTION" }, { order: "DESCENDING", queryScope: "COLLECTION" }]), singleFieldKey([{ order: "DESCENDING", queryScope: "COLLECTION" }, { order: "ASCENDING", queryScope: "COLLECTION" }]));
