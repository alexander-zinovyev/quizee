import assert from "node:assert/strict";
import { hasActiveForegroundRound } from "./host-rounds";

// Keeping sorting available must never block starting the next foreground round.
for (const state of ["scheduled", "active", "closed"] as const) {
  assert.equal(hasActiveForegroundRound([
    { type: "sorting", state }, { type: "text", state: "closed" }, { type: "text", state: "scheduled" },
  ]), false);
}
for (const type of ["text", "image", "multi-step", "color"] as const) {
  assert.equal(hasActiveForegroundRound([{ type: "sorting", state: "active" }, { type, state: "active" }]), true);
}
