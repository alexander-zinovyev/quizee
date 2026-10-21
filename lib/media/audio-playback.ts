/** Schedules the permitted audio on the audio clock, independent of UI updates. */
export class AudioPlayback {
  readonly duration: number;
  readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private offset = 0;
  private startedAt = 0;
  private request = 0;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    durationSeconds: number | undefined,
    private readonly onChange: () => void,
  ) {
    if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
      throw new Error("Playback limit must be a finite positive number.");
    }
    // Decoding can resample and round the source duration by one sample.
    if (durationSeconds !== undefined && durationSeconds > buffer.duration + 1 / buffer.sampleRate) {
      throw new Error(`Playback limit (${durationSeconds}s) exceeds the audio length (${buffer.duration}s).`);
    }
    this.duration = durationSeconds ?? buffer.duration;
    if (!Number.isFinite(this.duration) || this.duration <= 0) throw new Error("Audio has no playable duration.");
    this.gain = context.createGain();
    this.gain.connect(context.destination);
  }

  get playing() { return this.source !== null; }
  get position() {
    return Math.min(this.duration, this.offset + (this.playing ? this.context.currentTime - this.startedAt : 0));
  }

  async play() {
    const request = ++this.request;
    await this.context.resume();
    if (this.disposed || request !== this.request || this.playing) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.start();
  }

  pause() {
    ++this.request;
    this.offset = this.position;
    this.stop();
    this.onChange();
  }

  seek(position: number) {
    if (!Number.isFinite(position)) throw new Error("Invalid playback position.");
    const wasPlaying = this.playing;
    ++this.request;
    this.stop();
    this.offset = Math.max(0, Math.min(position, this.duration));
    if (wasPlaying && this.offset < this.duration) this.start();
    else this.onChange();
  }

  dispose() {
    this.disposed = true;
    ++this.request;
    this.stop();
    this.gain.disconnect();
  }

  private stop() {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  private start() {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.onended = () => {
      source.disconnect();
      this.source = null;
      this.offset = this.duration;
      this.onChange();
    };
    this.startedAt = this.context.currentTime;
    this.source = source;
    source.start(0, this.offset, this.duration - this.offset);
    this.onChange();
  }
}

export function formatAudioTime(seconds: number): string {
  // Keep configured fractional totals intact; elapsed time is rounded by the UI.
  if (seconds < 60) return `${seconds}s`;
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, "0");
  const fraction = String(seconds).split(".")[1];
  return `${minutes}:${remainder}${fraction ? `.${fraction}` : ""}`;
}
