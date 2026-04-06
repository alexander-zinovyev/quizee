export type MediaParticipant = {
  id: string;
  displayName?: string;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  isLocal?: boolean;
  isAudioEnabled?: boolean;
  isVideoEnabled?: boolean;
};

export type SubscriptionPolicy = {
  audio: "team-only" | "all" | "none";
  video: "team-only" | "all" | "none";
};

export interface MediaTransport {
  join(roomId: string, userId: string, displayName: string, authToken: string): Promise<void>;
  leave(): Promise<void>;
  setLocalAudioEnabled(enabled: boolean): Promise<void>;
  setLocalVideoEnabled(enabled: boolean): Promise<void>;

  setSubscriptionPolicy(
    policy: SubscriptionPolicy,
    options?: {
      teamId?: string | null;
      hostId?: string | null;
      isHost?: boolean;
      memberTeamMap?: Record<string, string | null>;
    }
  ): Promise<void>;

  onParticipantUpdate(cb: (participants: MediaParticipant[]) => void): () => void;
  onError(cb: (error: Error) => void): () => void;
}
