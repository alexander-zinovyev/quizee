import assert from "node:assert/strict";
import { getHostSortingView, getVisibleHostQuestions, hasActiveForegroundRound, type HostRound } from "./host-rounds";

// Keeping sorting available must never block starting the next foreground round.
for (const state of ["scheduled", "active", "closed"] as const) {
  assert.equal(hasActiveForegroundRound([
    { type: "sorting", state }, { type: "text", state: "closed" }, { type: "text", state: "scheduled" },
  ]), false);
}
for (const type of ["text", "image", "multi-step", "color"] as const) {
  assert.equal(hasActiveForegroundRound([{ type: "sorting", state: "active" }, { type, state: "active" }]), true);
}

// Media-only answers have no text hint, but their question must remain controllable.
for (const state of ["scheduled", "active", "closed"] as const) {
  const round: HostRound = {
    id: "text", title: "Text", roundNumber: 1, order: 0, type: "text", state,
    questions: [
      { id: "media-answer", prompt: "Listen to this", answer: "", order: 0 },
      { id: "text-answer", prompt: "Capital?", answer: "Paris", order: 1 },
    ],
  };
  assert.deepEqual(getVisibleHostQuestions(round), round.questions);
}

const sorting: HostRound = {
  id: "sorting", title: "Timeline", roundNumber: 1, order: 0, type: "sorting", state: "scheduled",
  questions: [], sortingQuestions: [], correctOrder: ["b", "a"], questionsLoaded: false,
};
assert.equal(getHostSortingView(sorting), null);
const items = [{ id: "a", text: "A" }, { id: "b", text: "B" }];
assert.equal(getHostSortingView({ ...sorting, sortingQuestions: items, questionsLoaded: true, correctOrder: undefined }), null);
assert.deepEqual(getHostSortingView({ ...sorting, sortingQuestions: items, questionsLoaded: true }), { items, order: ["b", "a"] });
assert.throws(() => getHostSortingView({ ...sorting, questionsLoaded: true }), /at least two/);
assert.throws(() => getHostSortingView({ ...sorting, sortingQuestions: items, questionsLoaded: true, correctOrder: ["b", "unknown"] }), /every item ID/);
