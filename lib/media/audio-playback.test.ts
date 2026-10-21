import assert from "node:assert/strict";
import { AudioPlayback, formatAudioTime } from "./audio-playback";

async function main() {
  const sources: Array<{ onended: (() => void) | null; start: (...args: number[]) => void; stop: () => void; disconnect: () => void; buffer: unknown; stopped: boolean; args: number[] }> = [];
  let resolveResume: (() => void) | undefined;
  const context = {
    currentTime: 0, destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => {
      const source = { onended: null as (() => void) | null, buffer: null as unknown, stopped: false, args: [] as number[],
        connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(...args: number[]) { this.args = args; } };
      sources.push(source);
      return source;
    },
  };
  const player = new AudioPlayback(context as unknown as AudioContext, { duration: 10, sampleRate: 48000 } as AudioBuffer, 0.1, () => {});
  await player.play();
  assert.deepEqual(sources[0].args, [0, 0, 0.1]);
  context.currentTime = 0.04;
  player.pause();
  assert.equal(player.position, 0.04);
  assert.equal(sources[0].stopped, true);
  await player.play();
  assert.deepEqual(sources[1].args, [0, 0.04, 0.060000000000000005]);
  player.seek(0.09);
  assert.ok(Math.abs(sources[2].args[2] - 0.01) < 1e-10);
  player.seek(100);
  assert.equal(player.playing, false);
  assert.equal(player.position, 0.1);
  await player.play();
  assert.deepEqual(sources[3].args, [0, 0, 0.1]);
  sources[3].onended!();
  assert.equal(player.playing, false);
  assert.equal(player.position, 0.1);
  player.dispose();

  context.resume = () => new Promise<void>((resolve) => { resolveResume = resolve; });
  const pending = new AudioPlayback(context as unknown as AudioContext, { duration: 1, sampleRate: 48000 } as AudioBuffer, 0.5, () => {});
  const count = sources.length;
  const playing = pending.play();
  pending.pause();
  resolveResume!();
  await playing;
  assert.equal(sources.length, count, "A blocked autoplay request must not start after hiding the stage");
  const disposedPlay = pending.play();
  pending.dispose();
  resolveResume!();
  await disposedPlay;
  assert.equal(sources.length, count);

  for (const duration of [0, -1, Infinity, NaN, 2]) {
    assert.throws(() => new AudioPlayback(context as unknown as AudioContext, { duration: 1, sampleRate: 48000 } as AudioBuffer, duration, () => {}));
  }
  assert.equal(formatAudioTime(0.1), "0.1s");
  assert.equal(formatAudioTime(0.5), "0.5s");
  assert.equal(formatAudioTime(2.75), "2.75s");
  assert.equal(formatAudioTime(65.5), "1:05.5");
  assert.equal(formatAudioTime(65.123456789012), "1:05.123456789012");
  assert.equal(formatAudioTime(119.999999999999), "1:59.999999999999");
}
void main();
