import type { MediaParticipant, MediaTransport, SubscriptionPolicy } from "./transport";

export class LocalTransport implements MediaTransport {
  private participant: MediaParticipant | null = null;
  private stream: MediaStream | null = null;
  private updateHandlers = new Set<(participants: MediaParticipant[]) => void>();
  private errorHandlers = new Set<(error: Error) => void>();

  async join(roomId: string, userId: string, displayName: string, authToken: string): Promise<void> {
    void roomId;
    void authToken;
    await this.leave();

    try {
      this.stream = await this.requestLocalStream();
      const audioTrack = this.stream.getAudioTracks()[0];
      const videoTrack = this.stream.getVideoTracks()[0];

      this.participant = {
        id: userId,
        displayName,
        audioTrack,
        videoTrack,
        isLocal: true,
        isAudioEnabled: audioTrack?.enabled ?? false,
        isVideoEnabled: videoTrack?.enabled ?? false,
      };
      this.notifyParticipants();
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error("Unable to access local media.");
      this.errorHandlers.forEach((handler) => handler(resolvedError));
      throw resolvedError;
    }
  }

  async leave(): Promise<void> {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.participant = null;
    this.notifyParticipants();
  }

  async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = enabled;
    if (this.participant) {
      this.participant = {
        ...this.participant,
        audioTrack: track,
        isAudioEnabled: enabled,
      };
      this.notifyParticipants();
    }
  }

  async setLocalVideoEnabled(enabled: boolean): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = enabled;
    if (this.participant) {
      this.participant = {
        ...this.participant,
        videoTrack: track,
        isVideoEnabled: enabled,
      };
      this.notifyParticipants();
    }
  }

  async setSubscriptionPolicy(policy: SubscriptionPolicy): Promise<void> {
    void policy;
    return;
  }

  onParticipantUpdate(cb: (participants: MediaParticipant[]) => void): () => void {
    this.updateHandlers.add(cb);
    cb(this.participant ? [this.participant] : []);
    return () => this.updateHandlers.delete(cb);
  }

  onError(cb: (error: Error) => void): () => void {
    this.errorHandlers.add(cb);
    return () => this.errorHandlers.delete(cb);
  }

  private notifyParticipants() {
    const participants = this.participant ? [this.participant] : [];
    this.updateHandlers.forEach((handler) => handler(participants));
  }

  private async requestLocalStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Media devices are not supported in this browser.");
    }

    const preferredConstraints: MediaStreamConstraints = { audio: true, video: true };
    try {
      return await navigator.mediaDevices.getUserMedia(preferredConstraints);
    } catch (preferredError) {
      const fallbacks: MediaStreamConstraints[] = [{ video: true }, { audio: true }];

      for (const constraints of fallbacks) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // Try the next fallback before surfacing the original error.
        }
      }

      throw preferredError instanceof Error
        ? preferredError
        : new Error("Unable to access local media.");
    }
  }
}
