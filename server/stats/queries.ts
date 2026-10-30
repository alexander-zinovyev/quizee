import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { statsId, statsPaths, STATS_ROOT, type StatsSortValue } from "./model";
import { decodeBoundCursor, encodeBoundCursor } from "./cursors";

export const STATS_SORTS = {
  games: { date: "number", host: "string", topScore: "number", totalScore: "number", margin: "number", pack: "string" },
  players: { gamesPlayed: "number", wins: "number", winRate: "number", ties: "number", losses: "number", teamPoints: "number", pointPercentage: "number" },
  playerGames: { date: "number", teamPoints: "number", result: "number", pointPercentage: "number" },
  hostedGames: { date: "number", pointPercentage: "number", topScore: "number", totalScore: "number" },
} as const;

export type StatsQueryKind = keyof typeof STATS_SORTS;
export type StatsQueryScope = { kind: "games" | "players" } | { kind: "playerGames" | "hostedGames"; personId: string };
export type StatsQueryOptions = { sort?: string; direction?: string; limit?: number; cursor?: string | null };
export type StatsQueryPlan = {
  kind: StatsQueryKind;
  collection: string;
  sort: string;
  direction: "asc" | "desc";
  limit: number;
  binding: string;
  equalities: Array<{ field: string; value: boolean }>;
  order: Array<{ field: string; direction: "asc" | "desc" }>;
  startAfter: Array<string | number> | null;
};

function cursorValues(plan: StatsQueryPlan, values: unknown): Array<string | number> {
  if (!Array.isArray(values) || values.length !== plan.order.length) throw new Error("Invalid statistics cursor values.");
  const sortType = (STATS_SORTS[plan.kind] as Record<string, string>)[plan.sort];
  values.forEach((value, index) => {
    const field = plan.order[index].field;
    if (field === "__name__") {
      if (typeof value !== "string") throw new Error("Invalid cursor document ID.");
      statsId(value);
    } else if (field.endsWith(".availability")) {
      if (value !== 0 && value !== 1) throw new Error("Invalid cursor availability.");
    } else {
      const type = index === 1 ? sortType : "number";
      if (typeof value !== type || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Invalid cursor sort value.");
    }
  });
  // Unknown buckets always use a canonical placeholder, so a fabricated value cannot skip rows.
  for (let index = 0; index < values.length - 1; index += 2) {
    if (values[index] === 1 && values[index + 1] !== (index === 0 && sortType === "string" ? "" : 0)) {
      throw new Error("Invalid unavailable cursor value.");
    }
  }
  return values;
}

export function planStatsQuery(scope: StatsQueryScope, options: StatsQueryOptions = {}): StatsQueryPlan {
  if (!Object.hasOwn(STATS_SORTS, scope.kind)) throw new Error("Unsupported statistics query.");
  const sorts: Record<string, string> = STATS_SORTS[scope.kind];
  const sort = options.sort ?? (scope.kind === "players" ? "gamesPlayed" : "date");
  const direction = options.direction ?? "desc";
  const limit = options.limit ?? 25;
  if (!Object.hasOwn(sorts, sort)) throw new Error("Unsupported statistics sort.");
  if (direction !== "asc" && direction !== "desc") throw new Error("Unsupported statistics direction.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Page size must be between 1 and 100.");
  const personId = "personId" in scope ? statsId(scope.personId) : null;
  const prefix = scope.kind === "games" ? "summary.sort" : scope.kind === "players" ? "player.sort" : "sort";
  const order: StatsQueryPlan["order"] = [
    { field: `${prefix}.${sort}.availability`, direction: "asc" },
    { field: `${prefix}.${sort}.value`, direction },
  ];
  if (scope.kind !== "players" && sort !== "date") order.push(
    { field: `${prefix}.date.availability`, direction: "asc" }, { field: `${prefix}.date.value`, direction: "desc" });
  order.push({ field: "__name__", direction: "asc" });
  const collection = scope.kind === "games" ? `${STATS_ROOT}/games` : scope.kind === "players" ? `${STATS_ROOT}/people`
    : `${statsPaths.person(personId!)}/${scope.kind}`;
  const plan: StatsQueryPlan = {
    kind: scope.kind, collection, sort, direction, limit, order,
    equalities: scope.kind === "games" ? [{ field: "published", value: true }]
      : scope.kind === "players" ? [{ field: "hasPlayerHistory", value: true }] : [],
    binding: JSON.stringify([scope.kind, personId, sort, direction]), startAfter: null,
  };
  if (options.cursor !== undefined && options.cursor !== null) {
    plan.startAfter = cursorValues(plan, decodeBoundCursor(options.cursor, plan.binding));
  }
  return plan;
}

/** Read limit + 1; return a cursor for the last emitted row only when another row exists. */
export function buildStatsQuery(db: Firestore, plan: StatsQueryPlan) {
  let query: FirebaseFirestore.Query = db.collection(plan.collection);
  for (const equality of plan.equalities) query = query.where(equality.field, "==", equality.value);
  for (const order of plan.order) query = query.orderBy(order.field === "__name__" ? FieldPath.documentId() : order.field, order.direction);
  if (plan.startAfter) query = query.startAfter(...plan.startAfter);
  return query.limit(plan.limit + 1);
}

export function encodeStatsCursor(plan: StatsQueryPlan, id: string, value: StatsSortValue, date?: StatsSortValue): string {
  const values = [value.availability, value.value];
  if (plan.order.length === 5) {
    if (!date) throw new Error("Cursor requires a secondary completion date.");
    values.push(date.availability, date.value);
  }
  values.push(statsId(id));
  return encodeBoundCursor(plan.binding, cursorValues(plan, values));
}

/** Query plans and deployment indexes share one definition. Tests reject stale checked-in indexes. */
export function statisticsIndexes() {
  const indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<Record<string, string>> }> = [];
  for (const kind of Object.keys(STATS_SORTS) as StatsQueryKind[]) {
    for (const sort of Object.keys(STATS_SORTS[kind])) for (const direction of ["asc", "desc"]) {
      const scope: StatsQueryScope = kind === "games" || kind === "players" ? { kind } : { kind, personId: "index-definition" };
      const plan = planStatsQuery(scope, { sort, direction });
      indexes.push({
        collectionGroup: kind === "players" ? "people" : kind, queryScope: "COLLECTION",
        fields: [
          ...plan.equalities.map(({ field }) => ({ fieldPath: field, order: "ASCENDING" })),
          ...plan.order.map(({ field, direction }) => ({ fieldPath: field, order: direction === "asc" ? "ASCENDING" : "DESCENDING" })),
        ],
      });
    }
  }
  for (const collectionGroup of ["playerGames", "hostedGames"]) indexes.push({
    collectionGroup, queryScope: "COLLECTION_GROUP",
    fields: [{ fieldPath: "namespace", order: "ASCENDING" }, { fieldPath: "aliasesNormalized", arrayConfig: "CONTAINS" }],
  });
  indexes.push({ collectionGroup: "people", queryScope: "COLLECTION", fields: [
    { fieldPath: "archived", order: "ASCENDING" }, { fieldPath: "searchName", order: "ASCENDING" }, { fieldPath: "__name__", order: "ASCENDING" },
  ] }, { collectionGroup: "people", queryScope: "COLLECTION", fields: [
    { fieldPath: "archived", order: "ASCENDING" }, { fieldPath: "helperAliasesNormalized", arrayConfig: "CONTAINS" },
  ] });
  indexes.push({ collectionGroup: "audit", queryScope: "COLLECTION", fields: [
    { fieldPath: "at", order: "DESCENDING" }, { fieldPath: "__name__", order: "ASCENDING" },
  ] });
  return { indexes, fieldOverrides: [] };
}
