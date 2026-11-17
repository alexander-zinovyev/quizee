import assert from "node:assert/strict";
import test from "node:test";
import type { MediaParticipant } from "../../lib/media/transport";
import { MoqTransport } from "../../lib/media/moq-transport";

test("MoQ preserves local media and team/host subscription policies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ relayUrl: "https://relay.example", broadcastName: "room/local", userId: "local" });
  try {
    const transport = new MoqTransport();
    let participants: MediaParticipant[] = [];
    transport.onParticipantUpdate((next) => { participants = next; });
    await transport.join("room", "local", "Player", "test-token");
    await transport.setSubscriptionPolicy({ audio: "team-only", video: "all" }, {
      teamId: "red", hostId: "host", memberTeamMap: { local: "red", teammate: "red", opponent: "blue" },
    });
    const find = (id: string) => participants.find((participant) => participant.id === id)!;
    assert.equal(find("teammate").mediaSource?.audioEnabled, true);
    assert.equal(find("host").mediaSource?.audioEnabled, true);
    assert.equal(find("opponent").mediaSource?.audioEnabled, false);
    assert.equal(find("opponent").mediaSource?.videoEnabled, true);
    await transport.setLocalAudioEnabled(false);
    await transport.setLocalVideoEnabled(false);
    assert.equal(find("local").mediaSource?.audioEnabled, false);
    assert.equal(find("local").mediaSource?.videoEnabled, false);
    await transport.setSubscriptionPolicy({ audio: "none", video: "none" });
    assert.deepEqual(participants.map(({ id }) => id), ["local"]);
    await transport.leave();
    assert.deepEqual(participants, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
