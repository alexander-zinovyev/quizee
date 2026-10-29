import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completionTime, gameSortValues, normalizeStatsName, sortNumber, sortText, statsPaths } from "./model";
import { encodeStatsCursor, planStatsQuery, statisticsIndexes, STATS_SORTS, type StatsQueryKind, type StatsQueryScope } from "./queries";

test("every required sort/direction has a deployed index and unknowns sort last", () => {
  const checkedIn = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  assert.deepEqual(checkedIn, statisticsIndexes());
  const firebase = JSON.parse(readFileSync("firebase.json", "utf8"));
  assert.equal(firebase.firestore.indexes, "firestore.indexes.json");
  for (const kind of Object.keys(STATS_SORTS) as StatsQueryKind[]) for (const sort of Object.keys(STATS_SORTS[kind])) {
    for (const direction of ["asc", "desc"]) {
      const scope: StatsQueryScope = kind === "games" || kind === "players" ? { kind } : { kind, personId: "p1" };
      const plan = planStatsQuery(scope, { sort, direction });
      assert.equal(plan.order[0].direction, "asc");
      assert.equal(plan.order.at(-1)?.field, "__name__");
      const value = (STATS_SORTS[kind] as Record<string, string>)[sort] === "string" ? sortText("Alias") : sortNumber(-0.5);
      const cursor = encodeStatsCursor(plan, "g1", value, sortNumber(null));
      assert.deepEqual(planStatsQuery(scope, { sort, direction, cursor }).startAfter,
        plan.order.length === 5 ? [0, value.value, 1, 0, "g1"] : [0, value.value, "g1"]);
    }
  }
});

test("cursors are bound to sort, direction, collection, and person", () => {
  const cursor = encodeStatsCursor(planStatsQuery({ kind: "playerGames", personId: "p1" }), "g1", sortNumber(1));
  assert.throws(() => planStatsQuery({ kind: "playerGames", personId: "p2" }, { cursor }));
  assert.throws(() => planStatsQuery({ kind: "hostedGames", personId: "p1" }, { cursor }));
  assert.throws(() => planStatsQuery({ kind: "playerGames", personId: "p1" }, { cursor, sort: "teamPoints" }));
  assert.throws(() => planStatsQuery({ kind: "playerGames", personId: "p1" }, { cursor, direction: "asc" }));
});

test("malformed requests/cursors and unavailable placeholders are refused", () => {
  for (const options of [{ sort: "__proto__" }, { sort: "arbitrary" }, { direction: "sideways" }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }]) {
    assert.throws(() => planStatsQuery({ kind: "games" }, options));
  }
  for (const cursor of ["", "%%", "null", Buffer.from("null").toString("base64url"), "x".repeat(16001)]) {
    assert.throws(() => planStatsQuery({ kind: "games" }, { cursor }));
  }
  const plan = planStatsQuery({ kind: "games" });
  for (const values of [[0, "1", "g1"], [2, 1, "g1"], [1, 5, "g1"], [0, 1, "../g1"], [0, 1], [0, null, "g1"]]) {
    const cursor = Buffer.from(JSON.stringify({ version: 1, binding: plan.binding, values })).toString("base64url");
    assert.throws(() => planStatsQuery({ kind: "games" }, { cursor }));
  }
});

test("collection boundaries and defaults remain statistics-only", () => {
  assert.deepEqual(planStatsQuery({ kind: "games" }).equalities, [{ field: "published", value: true }]);
  assert.deepEqual(planStatsQuery({ kind: "players" }).equalities, [{ field: "hasPlayerHistory", value: true }]);
  assert.equal(planStatsQuery({ kind: "games" }).collection, "stats/global/games");
  assert.equal(planStatsQuery({ kind: "players" }).collection, "stats/global/people");
  assert.equal(planStatsQuery({ kind: "players" }).sort, "gamesPlayed");
  assert.equal(planStatsQuery({ kind: "hostedGames", personId: "p1" }).collection, "stats/global/people/p1/hostedGames");
  assert.equal(planStatsQuery({ kind: "games" }).limit, 25);
  assert.throws(() => statsPaths.game("../rooms"));
  assert.throws(() => statsPaths.person("__name__"));
});

test("sort values keep unknowns distinct from zero and preserve signed scores", () => {
  assert.deepEqual(sortNumber(null), { availability: 1, value: 0 });
  assert.deepEqual(sortNumber(0), { availability: 0, value: 0 });
  assert.deepEqual(sortNumber(-0.5), { availability: 0, value: -0.5 });
  assert.equal(normalizeStatsName("  ＡLEX\t  Smith  "), "alex smith");
  assert.equal(sortText("Élodie").value, "élodie");
  assert.equal(completionTime(null), null);
  assert.equal(completionTime("2026-10-29T12:00:00.000Z"), Date.parse("2026-10-29T12:00:00.000Z"));
  for (const date of ["2026-02-30T00:00:00.000Z", "2026-10-29", "invalid"]) assert.throws(() => completionTime(date));
  assert.throws(() => sortNumber(NaN));
});

test("game sort values use recorded scores and never substitute a publication date", () => {
  const sorts = gameSortValues({ completedAt: null, host: null, packLabel: null,
    teams: [{ id: "red", name: "Red", score: -0.5, outcome: "tie", rank: 1 }, { id: "blue", name: "Blue", score: -0.5, outcome: "tie", rank: 1 }] });
  assert.deepEqual(sorts.date, sortNumber(null));
  assert.deepEqual(sorts.margin, sortNumber(0));
  assert.deepEqual(sorts.totalScore, sortNumber(-1));
  const unknown = gameSortValues({ completedAt: null, host: null, packLabel: null,
    teams: [{ id: "red", name: "Red", score: 2, outcome: "unavailable", rank: null }, { id: "blue", name: "Blue", score: null, outcome: "unavailable", rank: null }] });
  assert.deepEqual(unknown.topScore, sortNumber(null));
  assert.deepEqual(unknown.margin, sortNumber(null));
});
