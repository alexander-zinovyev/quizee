import DailyIframe, { type DailyCall } from "@daily-co/daily-js";

import type { MediaParticipant, MediaTransport, SubscriptionPolicy } from "./transport";

type DailyParticipant = {
  session_id: string;
  user_id?: string | null;
  user_name?: string | null;
  local?: boolean;
  tracks?: {
    audio?: { subscribed?: boolean; persistentTrack?: MediaStreamTrack | null };
    video?: { subscribed?: boolean; persistentTrack?: MediaStreamTrack | null };
  };
};

type DailyParticipantMap = Record<string, DailyParticipant>;

type DailySessionResponse = {
  roomName: string;
  token: string;
  userId: string;
  displayName?: string;
};

export class DailyTransport implements MediaTransport {
  private static sharedCall: DailyCall | null = null;
  private call: DailyCall | null = null;
  private participants = new Map<string, MediaParticipant>();
  private updateHandlers = new Set<(participants: MediaParticipant[]) => void>();
  private errorHandlers = new Set<(error: Error) => void>();
  private policy: SubscriptionPolicy | null = null;
  private policyOptions:
    | {
        teamId?: string | null;
        hostId?: string | null;
        isHost?: boolean;
        memberTeamMap?: Record<string, string | null>;
      }
    | undefined;

  async join(roomId: string, userId: string, displayName: string, authToken: string): Promise<void> {
    if (this.call) {
      await this.leave();
    }

    const response = await fetch(`/api/rooms/${roomId}/daily/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ userId, displayName }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message ?? "Unable to create Daily session.");
    }

    const payload = (await response.json()) as DailySessionResponse;

    const dailyAny = DailyIframe as unknown as {
      getCallObject?: () => DailyCall | null;
      createCallObject: (options?: Record<string, unknown>) => DailyCall;
    };
    const existing =
      dailyAny.getCallObject?.() ?? DailyTransport.sharedCall;
    this.call =
      existing ??
      dailyAny.createCallObject({
        subscribeToTracksAutomatically: false,
      });
    DailyTransport.sharedCall = this.call;

    this.call
      .on("participant-joined", this.handleParticipants)
      .on("participant-updated", this.handleParticipants)
      .on("participant-left", this.handleParticipants)
      .on("track-started", this.handleParticipants)
      .on("track-stopped", this.handleParticipants)
      .on("error", this.handleError);

    await this.call.join({
      url: this.roomUrl(payload.roomName),
      token: payload.token,
      userName: payload.displayName ?? displayName,
    });

    await this.call.setLocalAudio(true);
    await this.call.setLocalVideo(true);
    this.handleParticipants();
  }

  async leave(): Promise<void> {
    if (!this.call) return;
    try {
      await this.call.leave();
    } finally {
      this.call.off("participant-joined", this.handleParticipants);
      this.call.off("participant-updated", this.handleParticipants);
      this.call.off("participant-left", this.handleParticipants);
      this.call.off("track-started", this.handleParticipants);
      this.call.off("track-stopped", this.handleParticipants);
      this.call.off("error", this.handleError);
      this.call.destroy();
      this.call = null;
      this.participants.clear();
      this.notifyParticipants();
    }
  }

  async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    if (!this.call) return;
    await this.call.setLocalAudio(enabled);
    this.handleParticipants();
  }

  async setLocalVideoEnabled(enabled: boolean): Promise<void> {
    if (!this.call) return;
    await this.call.setLocalVideo(enabled);
    this.handleParticipants();
  }

  async setSubscriptionPolicy(
    policy: SubscriptionPolicy,
    options?: {
      teamId?: string | null;
      hostId?: string | null;
      isHost?: boolean;
      memberTeamMap?: Record<string, string | null>;
    }
  ): Promise<void> {
    this.policy = policy;
    this.policyOptions = options;
    if (!this.call) return;
    await this.applySubscriptionPolicy();
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

  private handleParticipants = () => {
    if (!this.call) return;
    const all = this.call.participants() as DailyParticipantMap;
    this.participants.clear();

    Object.values(all).forEach((participant) => {
      const id = participant.user_id ?? participant.session_id;
      this.participants.set(id, this.toMediaParticipant(participant));
    });

    void this.applySubscriptionPolicy();
    this.notifyParticipants();
  };

  private handleError = (event?: { error?: string | Error }) => {
    if (!event?.error) return;
    const error =
      typeof event.error === "string" ? new Error(event.error) : event.error;
    this.errorHandlers.forEach((handler) => handler(error));
  };

  private toMediaParticipant(participant: DailyParticipant): MediaParticipant {
    const audioTrack = participant.tracks?.audio?.persistentTrack ?? undefined;
    const videoTrack = participant.tracks?.video?.persistentTrack ?? undefined;
    const id = participant.user_id ?? participant.session_id;
    return {
      id,
      displayName: participant.user_name ?? undefined,
      audioTrack: audioTrack ?? undefined,
      videoTrack: videoTrack ?? undefined,
      isLocal: Boolean(participant.local),
      isAudioEnabled: audioTrack?.enabled ?? false,
      isVideoEnabled: videoTrack?.enabled ?? false,
    };
  }

  private notifyParticipants() {
    const list = Array.from(this.participants.values());
    this.updateHandlers.forEach((handler) => handler(list));
  }

  private roomUrl(roomName: string): string {
    const domain = process.env.NEXT_PUBLIC_DAILY_DOMAIN ?? "";
    if (!domain) {
      throw new Error("NEXT_PUBLIC_DAILY_DOMAIN is not set.");
    }
    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      return `${domain.replace(/\/$/, "")}/${roomName}`;
    }
    return `https://${domain.replace(/\/$/, "")}/${roomName}`;
  }

  private async applySubscriptionPolicy(): Promise<void> {
    if (!this.call || !this.policy) return;
    const policy = this.policy;
    const participants = this.call.participants() as DailyParticipantMap;
    const audio = policy.audio !== "none";
    const video = policy.video !== "none";
    const options = this.policyOptions;
    const isHost = options?.isHost ?? false;
    const teamId = options?.teamId ?? null;
    const hostId = options?.hostId ?? null;
    const memberTeamMap = options?.memberTeamMap ?? {};

    for (const participant of Object.values(participants)) {
      if (participant.local) continue;
      const targetId = participant.session_id;
      const participantId = participant.user_id ?? participant.session_id;
      const isHostParticipant = hostId != null && participantId === hostId;
      const participantTeam = memberTeamMap[participantId] ?? null;
      const shouldAudio =
        policy.audio === "team-only" && !isHost
          ? participantTeam === teamId || isHostParticipant
          : audio;
      try {
        await this.call.updateParticipant(targetId, {
          setSubscribedTracks: { audio: shouldAudio, video },
        });
      } catch {
        // ignore subscription errors to keep UI responsive
      }
    }
  }
}
