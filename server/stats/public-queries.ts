import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { PublicStatsGame, StatsList, StatsMapping, StatsQuestion } from "@/types/stats";
import type { PublicStatsGameDetail, PublicStatsHost, PublicStatsPlayer, PublicStatsQuestionPage, PublicStatsRosterEntry } from "@/types/stats-public";
import { hostSummary, playerSummary } from "./aggregates";
import { decodeBoundCursor, encodeBoundCursor } from "./cursors";
import { StatsError } from "./error";
import { historyExtremes, resultStreaks } from "./history-metrics";
import { inferQuestionMaximum, median } from "./metrics";
import { statsId, statsPaths, type StatsGameRecord, type StatsHostContribution, type StatsPersonRecord, type StatsPlayerContribution, type StatsSortMap } from "./model";
import { buildStatsQuery, encodeStatsCursor, planStatsQuery, type StatsQueryOptions, type StatsQueryPlan, type StatsQueryScope } from "./queries";
import { percentageFromCounters, publicMetrics, publicPercentage, publicPerson, publicQuestion } from "./serializers";
import { assertStatsPublicEnabled } from "./public-access";
import { statsOperation } from "./telemetry";
import { cacheStatsRead, documentCacheVersion } from "./read-cache";
import { stableJson } from "@/lib/stats/value";

const hidden = () => new StatsError("not-found", "Statistics are unavailable.", 404);
const inconsistent = () => new StatsError("statistics-inconsistent", "Statistics changed or need reconciliation. Reload before continuing.", 409);

export function publicQueryPlan(scope: StatsQueryScope, options: StatsQueryOptions) {
  try { return planStatsQuery(scope, options); }
  catch (error) { throw new StatsError("invalid-query", error instanceof Error ? error.message : "Invalid statistics query.", 400); }
}

async function publishedGame(tx: Transaction, db: Firestore, gameId: string, existing?: FirebaseFirestore.DocumentSnapshot) {
  try { statsId(gameId); } catch { throw hidden(); }
  const document = existing ?? await tx.get(db.doc(statsPaths.game(gameId)));
  const game = document.data() as StatsGameRecord | undefined;
  if (!game?.published || !game.publishedAt) throw hidden();
  const snapshot = await tx.get(db.doc(statsPaths.snapshot(gameId, game.snapshotId)));
  if (snapshot.data()?.ready !== true) throw hidden();
  if (!game.summary.metrics) throw inconsistent();
  return { game, snapshot };
}

type HeaderOptions = { existing?: FirebaseFirestore.DocumentSnapshot; loaded?: Awaited<ReturnType<typeof publishedGame>>;
  hosts?: Map<string, Promise<FirebaseFirestore.DocumentSnapshot>> };
async function gameHeader(tx: Transaction, db: Firestore, gameId: string, options: HeaderOptions = {}): Promise<PublicStatsGame> {
  const { game, snapshot } = options.loaded ?? await publishedGame(tx, db, gameId, options.existing);
  const hostId = game.review.hostPersonId;
  if (hostId && options.hosts && !options.hosts.has(hostId)) options.hosts.set(hostId, tx.get(db.doc(statsPaths.person(hostId))));
  const host = hostId ? await (options.hosts?.get(hostId) ?? tx.get(db.doc(statsPaths.person(hostId)))) : null;
  if (hostId && (!host?.exists || host.data()?.archived)) throw inconsistent();
  return { id: gameId, version: game.version, title: snapshot.data()!.title, snapshotAt: snapshot.data()!.snapshotAt,
    publishedAt: game.publishedAt!, completedAt: game.review.completedAt, packLabel: game.review.packLabel,
    host: snapshot.data()!.host ? { personId: hostId, alias: snapshot.data()!.host.alias, displayName: host?.data()?.displayName ?? null } : null,
    teams: publicMetrics(game.summary.metrics!).results, unresolvedAppearances: game.summary.unresolvedAppearances, provisional: game.summary.provisional };
}

async function roster(tx: Transaction, db: Firestore, gameId: string, game: StatsGameRecord): Promise<PublicStatsRosterEntry[]> {
  const ref = db.doc(statsPaths.snapshot(gameId, game.snapshotId));
  const [appearances, mappings] = await Promise.all([tx.get(ref.collection("appearances")), tx.get(db.doc(statsPaths.game(gameId)).collection("mappings"))]);
  const byAppearance = new Map(mappings.docs.map((document) => [document.id, document.data() as StatsMapping]));
  const ids = [...new Set(mappings.docs.map((document) => document.data().personId).filter((id): id is string => typeof id === "string"))];
  const names = new Map<string, { displayName: string; profile: "player" | "host" | null }>();
  if (ids.length) for (const person of await tx.getAll(...ids.map((id) => db.doc(statsPaths.person(id))), { fieldMask: ["displayName", "archived", "hasPlayerHistory", "hasHostHistory"] })) {
    if (!person.exists || person.data()?.archived) throw inconsistent();
    names.set(person.id, { displayName: person.data()!.displayName, profile: person.data()!.hasPlayerHistory ? "player" : person.data()!.hasHostHistory ? "host" : null });
  }
  return appearances.docs.map((document) => {
    const mapping = byAppearance.get(document.id), source = document.data();
    return { appearanceId: document.id, alias: source.alias, teamId: source.teamId, personId: mapping?.personId ?? null,
      displayName: mapping?.personId ? names.get(mapping.personId)?.displayName ?? null : null, duplicateOf: mapping?.duplicateOf ?? null,
      profile: mapping?.personId ? names.get(mapping.personId)?.profile ?? null : null };
  });
}

function nextListCursor(plan: StatsQueryPlan, documents: FirebaseFirestore.QueryDocumentSnapshot[], count: number, sortMap: (data: FirebaseFirestore.DocumentData) => StatsSortMap) {
  const last = documents.at(-1);
  if (!last || count <= plan.limit) return null;
  const values = sortMap(last.data());
  return encodeStatsCursor(plan, last.id, values[plan.sort], values.date);
}

export async function listPublicGames(db: Firestore, options: StatsQueryOptions = {}): Promise<StatsList<PublicStatsGame>> {
  assertStatsPublicEnabled();
  const plan = publicQueryPlan({ kind: "games" }, options);
  return db.runTransaction(async (tx) => {
    const result = await tx.get(buildStatsQuery(db, plan)), page = result.docs.slice(0, plan.limit);
    const hosts: NonNullable<HeaderOptions["hosts"]> = new Map();
    return { items: await Promise.all(page.map((document) => gameHeader(tx, db, document.id, { existing: document, hosts }))),
      nextCursor: nextListCursor(plan, page, result.size, (data) => data.summary.sort), sort: plan.sort, direction: plan.direction };
  }, { readOnly: true });
}

export async function listPublicPlayers(db: Firestore, options: StatsQueryOptions = {}) {
  assertStatsPublicEnabled();
  const plan = publicQueryPlan({ kind: "players" }, options);
  return db.runTransaction(async (tx) => {
    const result = await tx.get(buildStatsQuery(db, plan)), page = result.docs.slice(0, plan.limit);
    return { items: page.map((document) => {
      const person = document.data() as StatsPersonRecord;
      if (person.archived) throw inconsistent();
      return { ...publicPerson(document.id, person), summary: playerSummary(person.player.counters), percentage: percentageFromCounters(person.player.counters, "percentage") };
    }), nextCursor: nextListCursor(plan, page, result.size, (data) => data.player.sort), sort: plan.sort, direction: plan.direction };
  }, { readOnly: true });
}

export function getPublicGame(db: Firestore, gameId: string): Promise<PublicStatsGameDetail> {
  return statsOperation("public-game-detail", { gameId }, () => readPublicGame(db, gameId));
}
async function readPublicGame(db: Firestore, gameId: string): Promise<PublicStatsGameDetail> {
  assertStatsPublicEnabled();
  return db.runTransaction(async (tx) => {
    const loaded = await publishedGame(tx, db, gameId), { game } = loaded;
    return { ...await gameHeader(tx, db, gameId, { loaded }), roster: await roster(tx, db, gameId, game), metrics: publicMetrics(game.summary.metrics!) };
  }, { readOnly: true });
}

export async function getPublicRound(db: Firestore, gameId: string, roundId: string, version: number, options: { limit?: number; cursor?: string | null } = {}): Promise<PublicStatsQuestionPage> {
  assertStatsPublicEnabled();
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new StatsError("invalid-query", "Page size must be between 1 and 100.", 400);
  statsId(roundId);
  return db.runTransaction(async (tx) => {
    const { game } = await publishedGame(tx, db, gameId);
    if (game.version !== version) throw new StatsError("stale-version", "Game review changed. Reload current game detail.", 409);
    const ref = db.doc(statsPaths.snapshot(gameId, game.snapshotId)).collection("rounds").doc(roundId);
    const round = await tx.get(ref);
    if (!round.exists) throw hidden();
    const binding = JSON.stringify(["questions", gameId, roundId, version]);
    let query = ref.collection("questions").orderBy("order").orderBy(FieldPath.documentId());
    if (options.cursor) {
      let values: unknown[];
      try { values = decodeBoundCursor(options.cursor, binding); }
      catch { throw new StatsError("invalid-cursor", "Invalid question cursor.", 400); }
      if (values.length !== 2 || typeof values[0] !== "number" || !Number.isSafeInteger(values[0]) || values[0] < 0 || typeof values[1] !== "string") throw new StatsError("invalid-cursor", "Invalid question cursor.", 400);
      try { statsId(values[1]); } catch { throw new StatsError("invalid-cursor", "Invalid question cursor ID.", 400); }
      query = query.startAfter(...values);
    }
    const [questions, overrides] = await Promise.all([tx.get(query.limit(limit + 1)), tx.get(db.doc(statsPaths.game(gameId)).collection("questionOverrides").where("roundId", "==", roundId))]);
    const maxima = new Map(overrides.docs.map((override) => [override.data().questionId, override.data().points]));
    const page = questions.docs.slice(0, limit);
    const items = await Promise.all(page.map(async (question) => {
      const answers = await tx.get(question.ref.collection("answers"));
      const data = publicQuestion({ ...question.data(), answers: Object.fromEntries(answers.docs.map((answer) => [answer.id, answer.data()])) } as StatsQuestion);
      return { ...data, maximum: inferQuestionMaximum(round.data()!.scoring, maxima.get(question.id)) };
    }));
    const ids = new Set(items.flatMap((question) => [...question.prompt.map((stage) => stage.assetId), ...question.acceptedAnswer.map((stage) => stage.assetId),
      ...Object.values(question.answers).map((answer) => answer.assetId), question.color?.maskAssetId ?? null]).filter((id): id is string => id !== null));
    const assets: PublicStatsQuestionPage["assets"] = {};
    if (ids.size) for (const asset of await tx.getAll(...[...ids].map((id) => db.doc(statsPaths.snapshot(gameId, game.snapshotId)).collection("assets").doc(id)))) {
      if (asset.exists) assets[asset.id] = { filename: String(asset.data()!.storagePath).split("/").at(-1)! };
    }
    const last = page.at(-1);
    return { gameId, version, roundId, items, assets,
      nextCursor: questions.size > limit && last ? encodeBoundCursor(binding, [last.data().order, last.id]) : null };
  }, { readOnly: true });
}

async function publishedHistory(tx: Transaction, db: Firestore, ids: Array<{ gameId: string; gameVersion: number }>) {
  if (!ids.length) return;
  const games = await tx.getAll(...ids.map((row) => db.doc(statsPaths.game(row.gameId))), { fieldMask: ["published", "version"] });
  games.forEach((game, index) => { if (game.data()?.published !== true || game.data()?.version !== ids[index].gameVersion) throw inconsistent(); });
}

async function profile(tx: Transaction, db: Firestore, id: string, role: "player" | "host") {
  try { statsId(id); } catch { throw hidden(); }
  const ref = db.doc(statsPaths.person(id)), document = await tx.get(ref);
  if (!document.exists) throw hidden();
  const person = document.data() as StatsPersonRecord;
  if (person.archived) throw new StatsError("person-archived", "This profile has been archived.", 410);
  if (role === "player" ? !person.hasPlayerHistory : !person.hasHostHistory) throw hidden();
  return { ref, person, cacheVersion: `${person.version}:${documentCacheVersion(document)}` };
}

export function getPublicPlayer(db: Firestore, id: string): Promise<PublicStatsPlayer> {
  return statsOperation("public-player-detail", { personId: id }, () => readPublicPlayer(db, id));
}
async function readPublicPlayer(db: Firestore, id: string): Promise<PublicStatsPlayer> {
  assertStatsPublicEnabled();
  return db.runTransaction(async (tx) => {
    const { ref, person, cacheVersion } = await profile(tx, db, id, "player");
    const history = await cacheStatsRead(db, ["player-history", id, cacheVersion], async () => {
      const records = await tx.get(ref.collection("playerGames"));
      const rows = records.docs.map((document) => document.data() as StatsPlayerContribution);
      await publishedHistory(tx, db, rows);
      const teammates = new Map<string, number>(), opponents = new Map<string, number>();
      const rosterCoverage = { mapped: 0, total: 0 };
      for (const row of rows) {
        rosterCoverage.mapped += row.rosterCoverage.mapped; rosterCoverage.total += row.rosterCoverage.total;
        const seen = new Set<string>();
        for (const other of row.roster) if (other.personId !== id && !seen.has(other.personId)) {
          seen.add(other.personId);
          const counts = other.teamId === row.teamId ? teammates : opponents;
          counts.set(other.personId, (counts.get(other.personId) ?? 0) + 1);
        }
      }
      const points = rows.map((row) => ({ gameId: row.gameId, value: row.teamPoints })), percentages = rows.map((row) => ({ gameId: row.gameId, value: row.percentage.value }));
      return { aliases: [...new Set(rows.flatMap((row) => row.aliases))].sort(), streaks: resultStreaks(rows), rosterCoverage,
        teammates: [...teammates], opponents: [...opponents], bestPoints: historyExtremes(points, true), worstPoints: historyExtremes(points, false),
        bestPercentage: historyExtremes(percentages, true), worstPercentage: historyExtremes(percentages, false) };
    });
    const teammates = new Map(history.teammates), opponents = new Map(history.opponents);
    const names = new Map<string, string>(), ids = new Set([...teammates.keys(), ...opponents.keys()]);
    if (ids.size) for (const other of await tx.getAll(...[...ids].map((id) => db.doc(statsPaths.person(id))), { fieldMask: ["displayName", "archived"] })) {
      if (!other.exists || other.data()?.archived) throw inconsistent();
      names.set(other.id, other.data()!.displayName);
    }
    const frequencies = (counts: Map<string, number>) => [...counts].map(([personId, games]) => ({ personId, displayName: names.get(personId)!, games }))
      .sort((a, b) => b.games - a.games || (a.personId < b.personId ? -1 : 1));
    const byRoundType = Object.fromEntries(["text", "image", "multi-step", "color", "sorting", "clues"].filter((type) => Object.hasOwn(person.player.counters, `round:${type}:TotalGames`)).map((type) => [type,
      { percentage: percentageFromCounters(person.player.counters, `round:${type}:`), poolPercentage: percentageFromCounters(person.player.counters, `round:${type}:pool:`) }]));
    return { ...publicPerson(id, person), ...history, version: person.version, summary: playerSummary(person.player.counters),
      percentage: percentageFromCounters(person.player.counters, "percentage"), poolPercentage: percentageFromCounters(person.player.counters, "pool"), byRoundType,
      teammates: frequencies(teammates), opponents: frequencies(opponents) };
  }, { readOnly: true });
}

export function getPublicHost(db: Firestore, id: string): Promise<PublicStatsHost> {
  return statsOperation("public-host-detail", { personId: id }, () => readPublicHost(db, id));
}
async function readPublicHost(db: Firestore, id: string): Promise<PublicStatsHost> {
  assertStatsPublicEnabled();
  return db.runTransaction(async (tx) => {
    const { ref, person, cacheVersion } = await profile(tx, db, id, "host");
    const history = await cacheStatsRead(db, ["host-history", id, cacheVersion], async () => {
      const records = await tx.get(ref.collection("hostedGames")), rows = records.docs.map((document) => document.data() as StatsHostContribution);
      await publishedHistory(tx, db, rows);
      const percentages = rows.flatMap((row) => row.teamPercentages);
      return { aliases: [...new Set(rows.map((row) => row.alias).filter((alias): alias is string => alias !== null))].sort(),
        medianTeamPercentage: median(percentages), medianTeamSampleSize: percentages.length };
    });
    return { ...publicPerson(id, person), ...history, version: person.version,
      summary: hostSummary(person.host.counters), difficulty: percentageFromCounters(person.host.counters, "difficulty") };
  }, { readOnly: true });
}

export async function listPublicHistory(db: Firestore, id: string, role: "player" | "host", options: StatsQueryOptions = {}) {
  assertStatsPublicEnabled();
  const plan = publicQueryPlan({ kind: role === "player" ? "playerGames" : "hostedGames", personId: id }, options);
  return db.runTransaction(async (tx) => {
    const { cacheVersion } = await profile(tx, db, id, role);
    const page = await cacheStatsRead(db, ["history-page", id, role, cacheVersion, stableJson(plan)], async () => {
      const records = await tx.get(buildStatsQuery(db, plan)), documents = records.docs.slice(0, plan.limit);
      return { rows: documents.map((document) => document.data() as StatsPlayerContribution | StatsHostContribution),
        nextCursor: nextListCursor(plan, documents, records.size, (data) => data.sort) };
    });
    const hosts: NonNullable<HeaderOptions["hosts"]> = new Map();
    const items = await Promise.all(page.rows.map(async (row) => {
      const game = await gameHeader(tx, db, row.gameId, { hosts });
      if (game.version !== row.gameVersion) throw inconsistent();
      return { game, percentage: publicPercentage("percentage" in row ? row.percentage : row.difficulty),
        teamId: "teamId" in row ? row.teamId : null, teamPoints: "teamPoints" in row ? row.teamPoints : null, outcome: "outcome" in row ? row.outcome : null };
    }));
    return { items, nextCursor: page.nextCursor, sort: plan.sort, direction: plan.direction };
  }, { readOnly: true });
}

/** Returns a server-only allowlisted asset after publication checks; routes never accept Storage paths. */
export async function getPublishedAsset(db: Firestore, gameId: string, assetId: string) {
  assertStatsPublicEnabled();
  if (!/^[0-9a-f]{64}$/.test(assetId)) throw hidden();
  return db.runTransaction(async (tx) => {
    const { game } = await publishedGame(tx, db, gameId);
    const asset = await tx.get(db.doc(statsPaths.snapshot(gameId, game.snapshotId)).collection("assets").doc(assetId));
    if (!asset.exists) throw hidden();
    return { storagePath: asset.data()!.storagePath as string, contentType: asset.data()!.contentType as string | null };
  }, { readOnly: true });
}
