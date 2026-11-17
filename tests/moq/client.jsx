import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Member from "../../lib/components/member";

const params = new URLSearchParams(location.search);
const role = params.get("role");
const state = window.moqProbe = { ready: false, pcm: [], encoded: [], configs: [], decoded: [], errors: [] };
// Delay intact incoming streams in ordered batches. This models delivery jitter,
// while keeping the relay, MoQ protocol and encoded payloads real.
const period = Number(params.get("burst") || 0);
if (role === "watch" && period) {
  const NativeTransport = window.WebTransport;
  window.WebTransport = class extends NativeTransport {
    get incomingUnidirectionalStreams() {
      if (this.batched) return this.batched;
      const reader = super.incomingUnidirectionalStreams.getReader();
      const queue = [];
      let timer;
      this.batched = new ReadableStream({
        start(controller) {
          timer = setInterval(() => { for (const stream of queue.splice(0)) controller.enqueue(stream); }, period);
          (async () => {
            try {
              for (;;) { const next = await reader.read(); if (next.done) break; queue.push(next.value); }
              clearInterval(timer);
              for (const stream of queue) controller.enqueue(stream);
              controller.close();
            } catch (error) { clearInterval(timer); controller.error(error); }
          })();
        },
        cancel(reason) { clearInterval(timer); return reader.cancel(reason); },
      });
      return this.batched;
    }
  };
}
if (params.has("polyfill")) {
  // Exercise the shipped fallback, including its worker and wasm requests.
  window.AudioEncoder = undefined;
  window.AudioDecoder = undefined;
  window.AudioData = undefined;
  window.EncodedAudioChunk = undefined;
} else {
  const Encoder = window.AudioEncoder;
  window.AudioEncoder = class extends Encoder {
    constructor(init) {
      super({ ...init, output: (frame, metadata) => { state.encoded.push(frame.timestamp); init.output(frame, metadata); } });
    }
    configure(config) { state.configs.push(config); super.configure(config); }
  };
  const Decoder = window.AudioDecoder;
  window.AudioDecoder = class extends Decoder {
    constructor(init) { super({ ...init, output: (sample) => { state.decoded.push(sample.timestamp); init.output(sample); } }); }
  };
}
async function record(root) {
  const context = root.context;
  await context.audioWorklet.addModule("/audio-worklets.js");
  const recorder = new AudioWorkletNode(context, "recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  recorder.port.onmessage = ({ data }) => {
    if (data.stopped) { state.stopped?.(); return; }
    state.pcm.push(data.data);
    state.rate = data.sampleRate;
  };
  root.connect(recorder);
  recorder.connect(context.destination);
  state.recorder = recorder;
  await context.resume();
}
if (role === "publish") {
  const context = new AudioContext({ sampleRate: 48000 });
  await context.audioWorklet.addModule("/audio-worklets.js");
  const source = new AudioWorkletNode(context, "signal-source", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  const destination = context.createMediaStreamDestination();
  source.connect(destination);
  await record(source);
  state.generator = source;
  await context.resume();
  const canvas = document.createElement("canvas");
  canvas.width = 160; canvas.height = 90;
  const draw = () => { const ctx = canvas.getContext("2d"); ctx.fillStyle = "#179b72"; ctx.fillRect(0, 0, 160, 90); requestAnimationFrame(draw); };
  draw();
  const video = canvas.captureStream(5);
  navigator.mediaDevices.getUserMedia = async (constraints) => new MediaStream([
    ...(constraints.audio ? destination.stream.getAudioTracks().map((track) => track.clone()) : []),
    ...(constraints.video ? video.getVideoTracks().map((track) => track.clone()) : []),
  ]);
}
function Harness() {
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(params.has("video"));
  const [forcedMute, setForcedMute] = useState(false);
  state.setPolicy = (audio, video) => { setAudio(audio); setVideo(video); };
  state.forceMute = setForcedMute;
  return <Member name="Audio fixture" playbackMuted={role === "publish"} forcePlaybackMuted={forcedMute}
    mediaSource={{ type: "moq", mode: role, url: "http://localhost:4443/", name: params.get("name"), audioEnabled: audio, videoEnabled: video }}
    localAudioEnabled={audio} localVideoEnabled={video}
    onToggleLocalAudioEnabled={role === "publish" ? () => setAudio((value) => !value) : undefined}
    onToggleLocalVideoEnabled={role === "publish" ? () => setVideo((value) => !value) : undefined} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
await customElements.whenDefined("moq-" + role);
const element = document.querySelector("moq-" + role);
state.element = element;
if (role === "watch") element.signals.run((effect) => {
  const root = effect.get(element.audio.out.root);
  if (root) void record(root).catch((error) => state.errors.push(String(error)));
});
state.begin = (mode) => { state.pcm = []; state.encoded = []; state.decoded = []; state.generator?.port.postMessage(mode); };
state.seconds = () => state.pcm.reduce((count, block) => count + block.length, 0) / state.rate;
state.stop = () => new Promise((resolve) => { state.stopped = resolve; state.recorder.port.postMessage("stop"); });
state.metrics = () => {
  const samples = new Float32Array(state.pcm.reduce((count, block) => count + block.length, 0));
  let offset = 0;
  for (const block of state.pcm) { samples.set(block, offset); offset += block.length; }
  let lowWindows = 0, discontinuities = 0, lastEvent = -state.rate;
  const end = Math.min(samples.length - state.rate / 2, state.rate * 15);
  for (let at = state.rate; at < end; at += 480) {
    let squares = 0;
    for (let i = at; i < Math.min(at + 480, samples.length); i++) {
      squares += samples[i] * samples[i];
      if (Math.abs(samples[i] - samples[i - 1]) > 0.06 && i - lastEvent > state.rate * 0.01) { discontinuities++; lastEvent = i; }
    }
    if (Math.sqrt(squares / 480) < 0.03) lowWindows++;
  }
  return { seconds: samples.length / state.rate, lowWindows, discontinuities, encodedSpan: state.encoded.length ? (state.encoded.at(-1) - state.encoded[0]) / 1e6 : null, configs: state.configs, errors: state.errors };
};
state.ready = true;
