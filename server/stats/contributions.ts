import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { StatsReview } from "@/types/stats";
import { replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { StatsError } from "./error";
import { statsPaths, type StatsHostContribution, type StatsPersonRecord, type StatsPlayerContribution } from "./model";
import { verifyPersonCreation } from "./people";
import type { projectGame } from "./projection";
import { mappingCounts } from "./reviews";

/** Read every dependency first, then return a write plan for the caller's final transaction phase. */
export async function planContributionReplacement(tx: Transaction, db: Firestore, gameId: string,
  previous: StatsReview, next: StatsReview, published: boolean, projection: ReturnType<typeof projectGame>,
  creations: Map<string, StatsPersonRecord> = new Map()) {
  const before = mappingCounts(previous), after = mappingCounts(next);
  const ids = new Set([...before.keys(), ...after.keys(), ...creations.keys()]);
  const dependencies = await Promise.all([...ids].map(async (id) => {
    const personRef = db.doc(statsPaths.person(id)), playerRef = db.doc(statsPaths.playerGame(id, gameId)), hostRef = db.doc(statsPaths.hostedGame(id, gameId));
    const [person, player, host] = await Promise.all([tx.get(personRef), tx.get(playerRef), tx.get(hostRef)]);
    return { id, person, player, host, personRef, playerRef, hostRef };
  }));
  const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData | null }> = [];
  const impact: Array<{ personId: string; gamesPlayedBefore: number; gamesPlayedAfter: number; gamesHostedBefore: number; gamesHostedAfter: number }> = [];
  for (const dependency of dependencies) {
    const { id, person, player, host, personRef, playerRef, hostRef } = dependency;
    const proposed = creations.get(id), existing = person.data() as StatsPersonRecord | undefined;
    if (proposed && existing) verifyPersonCreation(existing, proposed);
    const data = existing ?? proposed;
    if (before.has(id) && !existing) throw new StatsError("mapping-integrity", "An existing mapping references a missing person.", 409);
    if (!data) throw new StatsError("person-not-found", "A mapped person no longer exists.", 422, { personId: id });
    if (data.archived && after.has(id)) throw new StatsError("person-archived", "Archived people cannot receive new mappings.", 422, { personId: id });
    const mappingCount = data.mappingCount + (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (!Number.isSafeInteger(mappingCount) || mappingCount < 0) throw new StatsError("mapping-integrity", "Person mapping counts are inconsistent.", 409);
    const previousPlayer = player.exists ? player.data() as StatsPlayerContribution : null;
    const previousHost = host.exists ? host.data() as StatsHostContribution : null;
    if (!published && (previousPlayer || previousHost)) throw new StatsError("history-integrity", "An unpublished game has public history contributions.", 409);
    const nextPlayer = published ? projection.players.get(id) ?? null : null;
    const nextHost = published && projection.host?.personId === id ? projection.host : null;
    const nextPlayerAggregate = replacePlayerAggregate(data.player, previousPlayer, nextPlayer);
    const nextHostAggregate = replaceHostAggregate(data.host, previousHost, nextHost);
    impact.push({ personId: id, gamesPlayedBefore: data.player.counters.gamesPlayed ?? 0, gamesPlayedAfter: nextPlayerAggregate.counters.gamesPlayed ?? 0,
      gamesHostedBefore: data.host.counters.gamesHosted ?? 0, gamesHostedAfter: nextHostAggregate.counters.gamesHosted ?? 0 });
    writes.push({ ref: personRef, data: { ...data, version: existing ? data.version + 1 : data.version, mappingCount,
      player: nextPlayerAggregate, host: nextHostAggregate, hasPlayerHistory: (nextPlayerAggregate.counters.gamesPlayed ?? 0) > 0,
      hasHostHistory: (nextHostAggregate.counters.gamesHosted ?? 0) > 0, updatedAt: new Date().toISOString() } });
    if (nextPlayer || previousPlayer) writes.push({ ref: playerRef, data: nextPlayer });
    if (nextHost || previousHost) writes.push({ ref: hostRef, data: nextHost });
  }
  return { writes, impact, createdPersonIds: dependencies.filter((dependency) => !dependency.person.exists && creations.has(dependency.id)).map((dependency) => dependency.id) };
}

export function applyContributionPlan(tx: Transaction, plan: Awaited<ReturnType<typeof planContributionReplacement>>): void {
  for (const { ref, data } of plan.writes) {
    if (data === null) tx.delete(ref);
    else tx.set(ref, data);
  }
}
