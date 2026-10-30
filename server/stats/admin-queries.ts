import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import { assertStatsAdmin } from "./authorization";
import { decodeBoundCursor, encodeBoundCursor } from "./cursors";
import { StatsError } from "./error";
import { statsId, statsPaths, STATS_ROOT, type StatsGameRecord, type StatsPersonRecord } from "./model";
import { projectGame } from "./projection";
import { loadReview, mappingCounts } from "./reviews";
import { loadSnapshot } from "./snapshots";

function afterId(cursor: string | null | undefined, binding: string): string | null {
  if (!cursor) return null;
  try {
    const values = decodeBoundCursor(cursor, binding);
    if (values.length !== 1 || typeof values[0] !== "string") throw new Error("Invalid cursor.");
    return statsId(values[0]);
  } catch { throw new StatsError("invalid-cursor", "Invalid administration cursor.", 400); }
}

export async function listAdminGames(db: Firestore, actorId: string, options: { tab?: string; roomCursor?: string | null; reviewCursor?: string | null } = {}) {
  const tab = options.tab ?? "unpublished";
  if (!["unpublished", "unresolved", "needs-review", "all"].includes(tab)) throw new StatsError("invalid-query", "Unsupported review filter.", 400);
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let roomsQuery = db.collection("rooms").where("state", "==", "ended").orderBy(FieldPath.documentId());
    let savedQuery = db.collection(`${STATS_ROOT}/games`).where("queueTags", "array-contains", tab).orderBy(FieldPath.documentId());
    const roomAfter = afterId(options.roomCursor, "admin-ended-rooms"), reviewAfter = afterId(options.reviewCursor, `admin-reviews:${tab}`);
    if (roomAfter) roomsQuery = roomsQuery.startAfter(roomAfter);
    if (reviewAfter) savedQuery = savedQuery.startAfter(reviewAfter);
    const [rooms, saved] = await Promise.all([tx.get(roomsQuery.limit(26)), tx.get(savedQuery.limit(26))]);
    const roomPage = rooms.docs.slice(0, 25), reviewPage = saved.docs.slice(0, 25);
    const titles = await Promise.all(reviewPage.map((document) => tx.get(db.doc(statsPaths.snapshot(document.id, document.data().snapshotId)))));
    const savedRooms = roomPage.length ? await tx.getAll(...roomPage.map((room) => db.doc(statsPaths.game(room.id))), { fieldMask: ["published", "version"] }) : [];
    return {
      saved: { items: reviewPage.map((document, index) => {
        const game = document.data() as StatsGameRecord;
        return { id: document.id, title: titles[index].data()?.title as string | undefined, version: game.version, published: game.published, completedAt: game.review.completedAt,
          unresolvedAppearances: game.summary.unresolvedAppearances, provisional: game.summary.provisional,
          tags: game.queueTags, warnings: game.summary.metrics?.warnings.map((warning) => warning.code) ?? [] };
      }), nextCursor: saved.size > 25 ? encodeBoundCursor(`admin-reviews:${tab}`, [reviewPage.at(-1)!.id]) : null },
      endedRooms: { items: roomPage.map((room, index) => ({ id: room.id, title: typeof room.data().title === "string" ? room.data().title : null,
        hasReview: savedRooms[index]?.exists ?? false, published: savedRooms[index]?.data()?.published ?? false })),
      nextCursor: rooms.size > 25 ? encodeBoundCursor("admin-ended-rooms", [roomPage.at(-1)!.id]) : null }, tab,
    };
  }, { readOnly: true });
}

export async function getAdminGame(db: Firestore, actorId: string, gameId: string) {
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(db.doc(statsPaths.game(gameId)));
    if (!document.exists) {
      const room = await tx.get(db.collection("rooms").doc(statsId(gameId)));
      if (room.data()?.state !== "ended") throw new StatsError("game-not-found", "An ended room or saved review was not found.", 404);
      return { id: gameId, title: typeof room.data()?.title === "string" ? room.data()!.title : "", version: 0, published: false,
        snapshot: null, review: null, people: [], summary: null, publishedAt: null };
    }
    const game = document.data() as StatsGameRecord, snapshot = await loadSnapshot(tx, db, gameId, game.snapshotId);
    const review = await loadReview(tx, db, gameId, game), ids = [...mappingCounts(review).keys()];
    const people = ids.length ? (await tx.getAll(...ids.map((id) => db.doc(statsPaths.person(id))))).map((person) => {
      if (!person.exists) throw new StatsError("mapping-integrity", "A saved mapping references a missing person.", 409);
      return { id: person.id, ...person.data() as StatsPersonRecord };
    }) : [];
    return { id: gameId, title: snapshot.title, version: game.version, published: game.published, publishedAt: game.publishedAt,
      snapshot, review, people, summary: projectGame(snapshot, review, game.version).summary };
  }, { readOnly: true });
}

export type AdminGameView = Awaited<ReturnType<typeof getAdminGame>>;

export async function listStatsAudit(db: Firestore, actorId: string, cursor?: string | null) {
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    let query = db.collection(`${STATS_ROOT}/audit`).orderBy("at", "desc").orderBy(FieldPath.documentId());
    if (cursor) {
      let values: unknown[];
      try { values = decodeBoundCursor(cursor, "admin-audit"); }
      catch { throw new StatsError("invalid-cursor", "Invalid change-history cursor.", 400); }
      if (values.length !== 2 || typeof values[0] !== "string" || typeof values[1] !== "string") throw new StatsError("invalid-cursor", "Invalid change-history cursor.", 400);
      query = query.startAfter(...values);
    }
    const result = await tx.get(query.limit(26)), page = result.docs.slice(0, 25), last = page.at(-1);
    return { items: page.map((document) => {
      const data = document.data();
      return { id: document.id, at: String(data.at), actorId: String(data.actorId), action: String(data.action),
        gameId: typeof data.gameId === "string" ? data.gameId : null, personId: typeof data.personId === "string" ? data.personId : null,
        snapshotId: typeof data.snapshotId === "string" ? data.snapshotId : null,
        targetUid: typeof data.targetUid === "string" ? data.targetUid : null,
        version: typeof data.version === "number" ? data.version : null,
        changedFields: Array.isArray(data.changedFields) ? data.changedFields.filter((field): field is string => typeof field === "string") : [] };
    }), nextCursor: result.size > 25 && last ? encodeBoundCursor("admin-audit", [last.data().at, last.id]) : null };
  }, { readOnly: true });
}

export async function getAdminAsset(db: Firestore, actorId: string, gameId: string, assetId: string) {
  if (!/^[0-9a-f]{64}$/.test(assetId)) throw new StatsError("not-found", "Asset unavailable.", 404);
  return db.runTransaction(async (tx: Transaction) => {
    await assertStatsAdmin(tx, db, actorId);
    const game = await tx.get(db.doc(statsPaths.game(gameId)));
    if (!game.exists) throw new StatsError("not-found", "Asset unavailable.", 404);
    const asset = await tx.get(db.doc(statsPaths.snapshot(gameId, game.data()!.snapshotId)).collection("assets").doc(assetId));
    if (!asset.exists) throw new StatsError("not-found", "Asset unavailable.", 404);
    return { storagePath: asset.data()!.storagePath as string, contentType: asset.data()!.contentType as string | null };
  }, { readOnly: true });
}
