import { parseArgs } from "node:util";
import { config } from "dotenv";
import { v1 } from "@google-cloud/firestore";
import { missingStatisticsIndexes, singleFieldKey } from "../server/stats/index-deployment";
import { statisticsIndexes } from "../server/stats/queries";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { values } = parseArgs({ options: { project: { type: "string" }, apply: { type: "boolean", default: false } } });
  if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID) throw new Error("Explicit --project must match FIREBASE_PROJECT_ID.");
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Index verification requires a real Firestore Admin API; the emulator does not validate production indexes.");
  const projectId = values.project, clientEmail = process.env.FIREBASE_CLIENT_EMAIL, privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("Firebase service-account credentials are required.");
  const client = new v1.FirestoreAdminClient({ projectId, credentials: { client_email: clientEmail, private_key: privateKey } });
  const parent = `projects/${projectId}/databases/(default)`, desired = statisticsIndexes();
  try {
    const [deployed] = await client.listIndexes({ parent: `${parent}/collectionGroups/-` });
    const composites = missingStatisticsIndexes(desired.indexes, deployed);
    const fields = [];
    for (const field of desired.fieldOverrides) {
      const name = `${parent}/collectionGroups/${field.collectionGroup}/fields/${field.fieldPath}`;
      const [current] = await client.getField({ name });
      const effective = (current.indexConfig?.indexes ?? []).map((index) => ({ queryScope: index.queryScope, ...index.fields?.find((entry) => entry.fieldPath === field.fieldPath) }));
      const configured = !current.indexConfig?.usesAncestorConfig && singleFieldKey(effective) === singleFieldKey(field.indexes);
      const ready = configured && (current.indexConfig?.indexes ?? []).every((index) => index.state === "READY");
      fields.push({ name, field, ready, configured });
    }
    const missing = composites.filter((entry) => entry.status === "missing"), pending = composites.filter((entry) => entry.status === "pending"), updates = fields.filter((entry) => !entry.configured), pendingFields = fields.filter((entry) => entry.configured && !entry.ready);
    console.log(JSON.stringify({ project: projectId, mode: values.apply ? "apply" : "verify", requiredCompositeIndexes: composites.length, readyCompositeIndexes: composites.filter((entry) => entry.status === "ready").length,
      missing: missing.map((entry) => entry.index), pending: pending.map(({ name, state }) => ({ name, state })), fieldUpdates: updates.map(({ field }) => field), pendingFields: pendingFields.map(({ name }) => name),
      unrelatedIndexesRetained: deployed.filter((entry) => !composites.some((required) => required.name === entry.name)).length }));
    if (values.apply) {
      // Create missing composites only. Never delete or replace an unrelated index.
      for (const { index } of missing) {
        const [operation] = await client.createIndex({ parent: `${parent}/collectionGroups/${index.collectionGroup}`, index: {
          queryScope: index.queryScope === "COLLECTION" ? "COLLECTION" : "COLLECTION_GROUP",
          fields: index.fields.map((field) => ({ fieldPath: field.fieldPath, ...(field.arrayConfig ? { arrayConfig: "CONTAINS" as const } : { order: field.order === "ASCENDING" ? "ASCENDING" as const : "DESCENDING" as const }) })),
        } });
        console.log(JSON.stringify({ action: "create-index", operation: operation.name }));
      }
      for (const { name, field } of updates) {
        const [operation] = await client.updateField({ field: { name, indexConfig: { indexes: field.indexes.map((index) => ({ queryScope: index.queryScope === "COLLECTION" ? "COLLECTION" : "COLLECTION_GROUP", fields: [{ fieldPath: field.fieldPath, order: index.order === "ASCENDING" ? "ASCENDING" : "DESCENDING" }] })) } }, updateMask: { paths: ["index_config"] } });
        console.log(JSON.stringify({ action: "configure-statistics-field", field: name, operation: operation.name }));
      }
      console.log("Index creation requested. Run verification again after the operations finish; do not expose navigation until every required index is ready.");
    } else if (missing.length || pending.length || updates.length || pendingFields.length) process.exitCode = 2;
  } finally { await client.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Index verification failed."); process.exitCode = 1; });
