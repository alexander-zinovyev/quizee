import { moqBroadcastName } from "./moq-paths";
import type { MediaParticipant, MediaTransport, SubscriptionPolicy } from "./transport";

type MoqSessionResponse = {
  relayUrl: string;
  broadcastName: string;
  userId: string;
  displayName?: string;
};

type PolicyOptions = {
  teamId?: string | null;
  hostId?: string | null;
  isHost?: boolean;
  memberTeamMap?: Record<string, string | null>;
};

export class MoqTransport implements MediaTransport {
  private roomId: string | null = null;
  private session: MoqSessionResponse | null = null;
  private audioEnabled = true;
  private videoEnabled = true;
  private policy: SubscriptionPolicy = { audio: "all", video: "all" };
  private policyOptions: PolicyOptions | undefined;
  private participants = new Map<string, MediaParticipant>();
  private updateHandlers = new Set<(participants: MediaParticipant[]) => void>();
  private errorHandlers = new Set<(error: Error) => void>();

  async join(roomId: string, userId: string, displayName: string, authToken: string): Promise<void> {
    await this.leave();

    const response = await fetch(`/api/rooms/${roomId}/moq/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ userId, displayName }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message ?? "Unable to create MoQ session.");
    }

    this.session = (await response.json()) as MoqSessionResponse;
    this.roomId = roomId;
    this.rebuildParticipants();
  }

  async leave(): Promise<void> {
    this.roomId = null;
    this.session = null;
    this.participants.clear();
    this.notifyParticipants();
  }

  async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    this.audioEnabled = enabled;
    this.rebuildParticipants();
  }

  async setLocalVideoEnabled(enabled: boolean): Promise<void> {
    this.videoEnabled = enabled;
    this.rebuildParticipants();
  }

  async setSubscriptionPolicy(policy: SubscriptionPolicy, options?: PolicyOptions): Promise<void> {
    this.policy = policy;
    this.policyOptions = options;
    this.rebuildParticipants();
  }

  onParticipantUpdate(cb: (participants: MediaParticipant[]) => void): () => void {
    this.updateHandlers.add(cb);
    cb(Array.from(this.participants.values()));
    return () => this.updateHandlers.delete(cb);
  }

  onError(cb: (error: Error) => void): () => void {
    this.errorHandlers.add(cb);
    return () => this.errorHandlers.delete(cb);
  }

  private rebuildParticipants() {
    if (!this.session) {
      return;
    }

    const session = this.session;
    const participants = new Map<string, MediaParticipant>();
    participants.set(session.userId, {
      id: session.userId,
      displayName: session.displayName,
      isLocal: true,
      isAudioEnabled: this.audioEnabled,
      isVideoEnabled: this.videoEnabled,
      mediaSource: {
        type: "moq",
        mode: "publish",
        url: session.relayUrl,
        name: session.broadcastName,
        audioEnabled: this.audioEnabled,
        videoEnabled: this.videoEnabled,
      },
    });

    const options = this.policyOptions;
    const memberTeamMap = options?.memberTeamMap ?? {};
    const remoteIds = new Set(Object.keys(memberTeamMap));
    if (options?.hostId) {
      remoteIds.add(options.hostId);
    }

    for (const participantId of remoteIds) {
      if (participantId === session.userId) continue;

      const mediaSource = this.remoteMediaSource(participantId, memberTeamMap);
      if (!mediaSource) continue;

      participants.set(participantId, {
        id: participantId,
        isAudioEnabled: mediaSource.audioEnabled,
        isVideoEnabled: mediaSource.videoEnabled,
        mediaSource,
      });
    }

    this.participants = participants;
    this.notifyParticipants();
  }

  private remoteMediaSource(
    participantId: string,
    memberTeamMap: Record<string, string | null>
  ): MediaParticipant["mediaSource"] | null {
    if (!this.session || !this.roomId) return null;

    const options = this.policyOptions;
    const isHost = options?.isHost ?? false;
    const teamId = options?.teamId ?? null;
    const hostId = options?.hostId ?? null;
    const participantTeam = memberTeamMap[participantId] ?? null;
    const isHostParticipant = hostId != null && participantId === hostId;
    const audioEnabled =
      this.policy.audio === "team-only" && !isHost
        ? participantTeam === teamId || isHostParticipant
        : this.policy.audio !== "none";
    const videoEnabled = this.policy.video !== "none";

    if (!audioEnabled && !videoEnabled) {
      return null;
    }

    return {
      type: "moq",
      mode: "watch",
      url: this.session.relayUrl,
      name: moqBroadcastName(this.roomId, participantId),
      audioEnabled,
      videoEnabled,
    };
  }

  private notifyParticipants() {
    const list = Array.from(this.participants.values());
    this.updateHandlers.forEach((handler) => handler(list));
  }
}
