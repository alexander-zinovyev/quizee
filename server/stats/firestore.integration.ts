import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp as initializeClient, deleteApp as deleteClient } from "firebase/app";
import { connectFirestoreEmulator, doc, getDoc, getFirestore as getClientFirestore, setDoc, terminate } from "firebase/firestore";
import { STATS_ROOT, sortNumber, sortText, type StatsSortMap, type StatsSortValue } from "./model";
import { buildStatsQuery, encodeStatsCursor, planStatsQuery, STATS_SORTS, type StatsQueryKind, type StatsQueryScope } from "./queries";

type Row = { id: string; sort: StatsSortMap };

async function main() {
  const address = process.env.FIRESTORE_EMULATOR_HOST;
  if (!address) throw new Error("Run test:stats:firestore through the Firestore emulator.");
  const projectId = "demo-quizee-drafts";
  const response = await fetch(`http://${address}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: await readFile("firestore.rules", "utf8") }] } }),
  });
  assert.ok(response.ok, await response.text());
  const app = initializeApp({ projectId }, "stats-integration");
  const db = getFirestore(app);
  const refs: FirebaseFirestore.DocumentReference[] = [];
  const scopes: StatsQueryScope[] = [{ kind: "games" }, { kind: "players" },
    { kind: "playerGames", personId: "profile" }, { kind: "hostedGames", personId: "profile" }];
  const fixtures = new Map<StatsQueryKind, Row[]>();
  try {
    const batch = db.batch();
    for (const scope of scopes) {
      const rows: Row[] = [];
      for (let index = 0; index < 67; index++) {
        const id = `stats-fixture-${String(index).padStart(3, "0")}`;
        const sort: StatsSortMap = {};
        for (const [key, type] of Object.entries(STATS_SORTS[scope.kind])) {
          // Repeated values span pages; unknowns and negative fractions expose sorting mistakes.
          const unknown = index % (key === "date" ? 5 : 7) === 0;
          sort[key] = type === "string" ? sortText(unknown ? null : `Alias ${index % 4}`)
            : sortNumber(unknown ? null : (index % 9) / 2 - 2);
        }
        const ref = db.collection(planStatsQuery(scope).collection).doc(id);
        refs.push(ref);
        batch.set(ref, scope.kind === "games" ? { published: index !== 66, summary: { sort } }
          : scope.kind === "players" ? { hasPlayerHistory: index !== 66, player: { sort } }
          : { sort, namespace: "global", aliasesNormalized: ["shared alias"] });
        if (index !== 66 || (scope.kind !== "games" && scope.kind !== "players")) rows.push({ id, sort });
      }
      fixtures.set(scope.kind, rows);
    }
    const hiddenRef = db.doc(`${STATS_ROOT}/games/stats-fixture-066/snapshots/private`);
    refs.push(hiddenRef);
    batch.set(hiddenRef, { ready: true, sourceMembers: { uid: "private" } });
    await batch.commit();

    let queries = 0;
    for (const scope of scopes) for (const sort of Object.keys(STATS_SORTS[scope.kind])) for (const direction of ["asc", "desc"]) {
      const expected = [...fixtures.get(scope.kind)!].sort((left, right) => {
        const compare = (a: StatsSortValue, b: StatsSortValue, descending: boolean) =>
          a.availability - b.availability || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) * (descending ? -1 : 1);
        return compare(left.sort[sort], right.sort[sort], direction === "desc") ||
          (scope.kind !== "players" && sort !== "date" ? compare(left.sort.date, right.sort.date, true) : 0) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      }).map((row) => row.id);
      const actual: string[] = [];
      let cursor: string | null = null;
      do {
        const plan = planStatsQuery(scope, { sort, direction, limit: 11, cursor });
        const snapshot = await buildStatsQuery(db, plan).get();
        queries++;
        const page = snapshot.docs.slice(0, plan.limit);
        actual.push(...page.map((row) => row.id));
        const last = page.at(-1);
        const values = last ? fixtures.get(scope.kind)!.find((row) => row.id === last.id)!.sort : null;
        cursor = snapshot.size > plan.limit && last && values ? encodeStatsCursor(plan, last.id, values[sort], values.date) : null;
        assert.ok(actual.length <= expected.length, "Pagination must advance without duplicates.");
      } while (cursor);
      assert.deepEqual(actual, expected, `${scope.kind}/${sort}/${direction}`);
    }

    // A claimed administrator still cannot bypass the browser/server boundary.
    for (const uid of [null, "stats-admin"]) {
      const clientApp = initializeClient({ projectId, apiKey: "fake" }, `stats-rules-${uid}`);
      const client = getClientFirestore(clientApp);
      const [host, port] = address.split(":");
      connectFirestoreEmulator(client, host, Number(port), uid ? { mockUserToken: { sub: uid, admin: true } } : {});
      try {
        for (const path of [`${STATS_ROOT}/games/stats-fixture-000`, hiddenRef.path,
          `${STATS_ROOT}/people/stats-fixture-000`, `${STATS_ROOT}/audit/event`, "users/stats-admin", "roles/stats-admin", "roles/_state"]) {
          const denied = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => (error as { code: string }).code === "permission-denied");
          await denied(getDoc(doc(client, path)));
          await denied(setDoc(doc(client, path), { malicious: true }));
        }
      } finally {
        await terminate(client);
        await deleteClient(clientApp);
      }
    }
    console.log(`Verified all statistics sorts across ${queries} paginated Firestore reads and browser isolation.`);
  } finally {
    const cleanup = db.batch();
    refs.forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
    await db.terminate();
    await deleteApp(app);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
