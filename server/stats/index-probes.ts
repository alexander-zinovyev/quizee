import { FieldPath, type Firestore, type Query } from "firebase-admin/firestore";
import { STATS_NAMESPACE, STATS_ROOT } from "./model";
import { buildStatsQuery, planStatsQuery, STATS_SORTS, type StatsQueryScope } from "./queries";

/** Read-only shape probes. Limit every query; no source payload is returned to the operator. */
export function statisticsIndexProbes(db: Firestore) {
  const probes: Array<{ label: string; query: Query }> = [];
  const scopes: StatsQueryScope[] = [{ kind: "games" }, { kind: "players" }, { kind: "playerGames", personId: "statistics-index-probe" }, { kind: "hostedGames", personId: "statistics-index-probe" }];
  for (const scope of scopes) for (const sort of Object.keys(STATS_SORTS[scope.kind])) for (const direction of ["asc", "desc"]) {
    probes.push({ label: `${scope.kind}/${sort}/${direction}`, query: buildStatsQuery(db, planStatsQuery(scope, { sort, direction, limit: 1 })) });
  }
  for (const collection of ["playerGames", "hostedGames"]) probes.push({ label: `${collection}/recorded-alias`, query: db.collectionGroup(collection).where("namespace", "==", STATS_NAMESPACE).where("aliasesNormalized", "array-contains", "statistics index probe").limit(1) });
  const people = db.collection(`${STATS_ROOT}/people`), games = db.collection(`${STATS_ROOT}/games`);
  probes.push({ label: "people/name-prefix", query: people.where("archived", "==", false).where("searchName", ">=", "statistics index probe").where("searchName", "<", "statistics index probf").orderBy("searchName").limit(1) },
    { label: "people/helper-alias", query: people.where("archived", "==", false).where("helperAliasesNormalized", "array-contains", "statistics index probe").limit(1) },
    { label: "audit/recent", query: db.collection(`${STATS_ROOT}/audit`).orderBy("at", "desc").orderBy(FieldPath.documentId()).limit(1) },
    { label: "audit/cleanup", query: db.collection(`${STATS_ROOT}/audit`).where("at", "<", "2000-01-01T00:00:00.000Z").orderBy("at").orderBy(FieldPath.documentId()).limit(1) },
    { label: "rooms/ended", query: db.collection("rooms").where("state", "==", "ended").orderBy(FieldPath.documentId()).limit(1) },
    { label: "games/review-queue", query: games.where("queueTags", "array-contains", "unpublished").orderBy(FieldPath.documentId()).limit(1) },
    { label: "games/host-mappings", query: games.where("review.hostPersonId", "==", "statistics-index-probe").limit(1) },
    { label: "mappings/person", query: db.collectionGroup("mappings").where("personId", "==", "statistics-index-probe").limit(1) },
    { label: "snapshots/cleanup", query: db.collectionGroup("snapshots").where("snapshotAt", "<", "2000-01-01T00:00:00.000Z").orderBy("snapshotAt").orderBy(FieldPath.documentId()).limit(1) },
    { label: "questions/order", query: games.doc("statistics-index-probe").collection("snapshots").doc("probe").collection("rounds").doc("probe").collection("questions").orderBy("order").orderBy(FieldPath.documentId()).limit(1) },
    { label: "maxima/round", query: games.doc("statistics-index-probe").collection("questionOverrides").where("roundId", "==", "probe").limit(1) });
  return probes;
}
