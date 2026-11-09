import assert from "node:assert/strict";

import type { RoundMeta } from "@/lib/hooks/use-room-rounds";
import { getAudioIsolatedRound } from "./round-audio";

for (const type of ["text", "multi-step", "color", "image"] as const) {
  for (const state of ["scheduled", "active", "closed"] as const) {
    const round: RoundMeta = { id: "round-1", title: "Round", order: 0, type, state };
    const shouldIsolate = state === "active" && type !== "image";
    assert.equal(
      getAudioIsolatedRound([round]),
      shouldIsolate ? round : null,
      `${state} ${type} round audio isolation`
    );
  }
}

assert.equal(getAudioIsolatedRound([]), null);

const scheduled: RoundMeta = { id: "next", title: "Next", order: 1, type: "text", state: "scheduled" };
const closed: RoundMeta = { ...scheduled, id: "previous", state: "closed" };
const active: RoundMeta = { ...scheduled, id: "current", type: "color", state: "active" };
assert.equal(getAudioIsolatedRound([closed, scheduled, active]), active);

assert.equal(getAudioIsolatedRound([{ id: "clues", type: "clues", state: "active", title: "Clues", order: 0, startingCoins: 5 }])?.id, "clues");
