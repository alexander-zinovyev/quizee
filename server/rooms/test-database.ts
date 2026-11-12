import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { Presentation } from "./presentation";

type Data = Record<string, unknown>;
class Ref {
  constructor(readonly path: string) {}
  get id() { return this.path.split("/").at(-1)!; }
  collection(name: string) { return new Collection(`${this.path}/${name}`); }
}
class Collection {
  constructor(readonly path: string) {}
  doc(id: string) { return new Ref(`${this.path}/${id}`); }
}

export const current: Presentation = { round: "r1", question: "q1", promptPage: 0, answerPage: 0, withAnswer: false };
export const redAnswer = "rooms/demo/teams/red/rounds/r1/answers/q1";
export const blueAnswer = "rooms/demo/teams/blue/rounds/r1/answers/q1";

export function database(type: "text" | "multi-step" | "image" | "clues" = "multi-step", allowAnswerChanges = true) {
  const docs = new Map<string, Data>([
    ["rooms/demo", { state: "playing", presenting: current }],
    ["rooms/demo/members/host", { role: "host", team: null }],
    ["rooms/demo/members/player", { role: "player", team: "red" }],
    ["rooms/demo/members/teammate", { role: "player", team: "red" }],
    ["rooms/demo/members/outsider", { role: "player", team: "blue" }],
    ["rooms/demo/teams/red", { name: "Red" }],
    ["rooms/demo/teams/blue", { name: "Blue" }],
    ["rooms/demo/rounds/r1", { type, state: "active", pointsPerStep: [5, 3, 0], allowAnswerChanges,
      activeWindow: { startedAt: "start", endedAt: null } }],
    ["rooms/demo/rounds/r2", { type: "text", state: "scheduled" }],
    ["rooms/demo/rounds/r1/questions/q1", { stages: [{ text: "A" }, { text: "B" }, { text: "C" }] }],
    ["rooms/demo/rounds/r1/questions/q2", { stages: [{ text: "D" }, { text: "E" }, { text: "F" }] }],
    [redAnswer, { answer: "Paris", locked: false, user: "player", ...(type === "multi-step" ? { attempts: [] } : {}) }],
    [blueAnswer, { answer: "", locked: false, user: "outsider", ...(type === "multi-step" ? { attempts: [] } : {}) }],
  ]);
  const snapshot = (ref: Ref) => ({ ref, id: ref.id, exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const db = {
    doc: (path: string) => new Ref(path),
    collection: (name: string) => new Collection(name),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const result = await work({
        get: async (ref: Ref | Collection) => {
          assert.equal(writes.length, 0, "Transactions must finish reading before writing");
          if (ref instanceof Ref) return snapshot(ref);
          return { docs: [...docs.keys()].filter((path) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/"))
            .map((path) => snapshot(new Ref(path))) };
        },
        getAll: async (...refs: Ref[]) => {
          assert.equal(writes.length, 0, "Transactions must finish reading before writing");
          return refs.map(snapshot);
        },
        set: (ref: Ref, data: Data, options: { merge?: boolean } = {}) => writes.push(() => docs.set(ref.path,
          options.merge ? { ...docs.get(ref.path), ...data } : data)),
        update: (ref: Ref, data: Data) => writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...data })),
      });
      writes.forEach((write) => write());
      return result;
    },
  } as unknown as Firestore;
  return { db, docs };
}
