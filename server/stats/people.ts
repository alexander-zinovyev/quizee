import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { replaceHostAggregate, replacePlayerAggregate } from "./aggregates";
import { assertStatsAdmin } from "./authorization";
import { StatsError } from "./error";
import { normalizeStatsName, statsPaths, STATS_NAMESPACE, STATS_ROOT, type StatsPersonRecord } from "./model";

export type CreateStatsPerson = { id: string; displayName: string; helperAliases?: string[]; notes?: string };
export type EditStatsPerson = { expectedVersion: number; displayName?: string; helperAliases?: string[]; notes?: string; archived?: boolean };

function personFields(input: { displayName: string; helperAliases?: string[]; notes?: string }) {
  const validName = (name: unknown): name is string => typeof name === "string" && Boolean(name.trim()) && name.length <= 200 && name.isWellFormed();
  if (!validName(input.displayName)) throw new StatsError("invalid-name", "A display name of 1-200 characters is required.", 400);
  const aliases = input.helperAliases === undefined ? [] : input.helperAliases;
  if (!Array.isArray(aliases) || aliases.length > 50 || !aliases.every(validName)) throw new StatsError("invalid-aliases", "Helper aliases must contain up to 50 nonempty names of at most 200 characters.", 400);
  const notes = input.notes === undefined ? "" : input.notes;
  if (typeof notes !== "string" || notes.length > 5000) throw new StatsError("invalid-notes", "Notes must contain at most 5,000 characters.", 400);
  const displayName = input.displayName.trim(), helperAliases = [...new Set(aliases.map((alias) => alias.trim()))];
  return { displayName, searchName: normalizeStatsName(displayName), helperAliases,
    helperAliasesNormalized: [...new Set(helperAliases.map(normalizeStatsName))], notes };
}

export function newStatsPerson(input: CreateStatsPerson, actorId: string): StatsPersonRecord {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["id", "displayName", "helperAliases", "notes"].includes(key))) {
    throw new StatsError("invalid-person", "Unsupported person creation fields.", 400);
  }
  if (typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.id)) {
    throw new StatsError("invalid-creation-id", "A stable UUID v4 is required for person creation.", 400);
  }
  const fields = personFields(input), at = new Date().toISOString();
  return { schemaVersion: 1, version: 1, ...fields, mappingCount: 0, archived: false, hasPlayerHistory: false, hasHostHistory: false,
    player: replacePlayerAggregate(null, null, null), host: replaceHostAggregate(null, null, null), createdBy: actorId,
    creationFingerprint: createHash("sha256").update(JSON.stringify(fields)).digest("hex"), createdAt: at, updatedAt: at };
}

export function verifyPersonCreation(existing: StatsPersonRecord, proposed: StatsPersonRecord): void {
  if (existing.creationFingerprint !== proposed.creationFingerprint || existing.createdBy !== proposed.createdBy) {
    throw new StatsError("creation-conflict", "This creation ID belongs to a different person creation request.", 409);
  }
}

export async function createStatsPerson(db: Firestore, actorId: string, input: CreateStatsPerson) {
  const proposed = newStatsPerson(input, actorId), ref = db.doc(statsPaths.person(input.id));
  const audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const previous = await tx.get(ref);
    if (previous.exists) { verifyPersonCreation(previous.data() as StatsPersonRecord, proposed); return { id: ref.id, version: previous.data()!.version }; }
    tx.create(ref, proposed);
    tx.create(audit, { actorId, action: "create-person", personId: ref.id, version: 1, at: proposed.createdAt });
    return { id: ref.id, version: 1 };
  });
}

export async function editStatsPerson(db: Firestore, actorId: string, personId: string, input: EditStatsPerson) {
  const ref = db.doc(statsPaths.person(personId)), audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const document = await tx.get(ref);
    if (!document.exists) throw new StatsError("person-not-found", "Person not found.", 404);
    const previous = document.data() as StatsPersonRecord;
    if (previous.archived) throw new StatsError("person-archived", "This person is archived.", 410);
    if (input.archived !== undefined && input.archived !== true) throw new StatsError("invalid-archive", "Archived records cannot be restored.", 422);
    const fields = personFields({ displayName: Object.hasOwn(input, "displayName") ? input.displayName! : previous.displayName,
      helperAliases: Object.hasOwn(input, "helperAliases") ? input.helperAliases : previous.helperAliases,
      notes: Object.hasOwn(input, "notes") ? input.notes : previous.notes });
    const archived = input.archived ?? false;
    const changed = Object.keys(fields).filter((key) => JSON.stringify(fields[key as keyof typeof fields]) !== JSON.stringify(previous[key as keyof StatsPersonRecord]));
    if (archived) changed.push("archived");
    if (!changed.length) return { id: ref.id, version: previous.version };
    if (input.expectedVersion !== previous.version) throw new StatsError("stale-version", "This person changed. Reload before continuing.", 409);
    if (archived && (previous.mappingCount !== 0 || previous.hasPlayerHistory || previous.hasHostHistory)) throw new StatsError("person-in-use", "Remove every player and host mapping before archiving this person.", 422);
    const at = new Date().toISOString();
    tx.update(ref, { ...fields, archived, version: previous.version + 1, updatedAt: at });
    tx.create(audit, { actorId, action: archived ? "archive-person" : "edit-person", personId, changedFields: changed, version: previous.version + 1, at });
    return { id: ref.id, version: previous.version + 1 };
  });
}

function prefixSuccessor(prefix: string): string | null {
  const codepoints = Array.from(prefix, (character) => character.codePointAt(0)!);
  while (codepoints.length) {
    const last = codepoints.pop()!;
    if (last < 0x10ffff) return String.fromCodePoint(...codepoints, last === 0xd7ff ? 0xe000 : last + 1);
  }
  return null;
}

export async function searchStatsPeople(db: Firestore, actorId: string, search: string) {
  if (typeof search !== "string" || !search.trim() || search.length > 200 || !search.isWellFormed()) throw new StatsError("invalid-search", "Enter a name, exact alias, or person ID of at most 200 characters.", 400);
  const normalized = normalizeStatsName(search), upper = prefixSuccessor(normalized);
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const people = db.collection(`${STATS_ROOT}/people`);
    let prefix = people.where("archived", "==", false).where("searchName", ">=", normalized).orderBy("searchName");
    if (upper) prefix = prefix.where("searchName", "<", upper);
    const [names, helpers, playerAliases, hostAliases] = await Promise.all([
      tx.get(prefix.limit(25)), tx.get(people.where("archived", "==", false).where("helperAliasesNormalized", "array-contains", normalized).limit(25)),
      tx.get(db.collectionGroup("playerGames").where("namespace", "==", STATS_NAMESPACE).where("aliasesNormalized", "array-contains", normalized).limit(25)),
      tx.get(db.collectionGroup("hostedGames").where("namespace", "==", STATS_NAMESPACE).where("aliasesNormalized", "array-contains", normalized).limit(25)),
    ]);
    const found = new Map([...names.docs, ...helpers.docs].map((document) => [document.id, document]));
    const ids = new Set([...playerAliases.docs, ...hostAliases.docs].filter((document) => document.ref.path.startsWith(`${STATS_ROOT}/people/`)).map((document) => document.ref.parent.parent!.id));
    if (/^[0-9a-f-]{36}$/.test(search)) ids.add(search);
    for (const id of ids) if (!found.has(id)) {
      const document = await tx.get(people.doc(id));
      if (document.exists && document.data()?.archived === false) found.set(id, document as FirebaseFirestore.QueryDocumentSnapshot);
    }
    return [...found].map(([id, document]) => ({ id, ...document.data() as StatsPersonRecord }))
      .sort((left, right) => left.searchName < right.searchName ? -1 : left.searchName > right.searchName ? 1 : left.id < right.id ? -1 : 1).slice(0, 25);
  }, { readOnly: true });
}
