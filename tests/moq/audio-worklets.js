class SignalSource extends AudioWorkletProcessor {
  constructor() {
    super();
    this.offset = 0;
    this.mode = "tone";
    this.port.onmessage = ({ data }) => { this.mode = data; this.offset = 0; };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    for (let i = 0; i < output.length; i++) {
      const seconds = this.offset / sampleRate;
      const amplitude = this.mode === "quiet" && Math.floor(seconds) % 4 !== 0 ? 0.00001 : 0.15;
      output[i] = amplitude * Math.sin(2 * Math.PI * 997 * seconds);
      this.offset++;
    }
    return true;
  }
}
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = [];
    this.count = 0;
    this.running = true;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") {
        this.flush();
        this.running = false;
        this.port.postMessage({ stopped: true });
      }
    };
  }
  flush() {
    const data = new Float32Array(this.count);
    let offset = 0;
    for (const frame of this.frames) { data.set(frame, offset); offset += frame.length; }
    this.port.postMessage({ data, sampleRate }, [data.buffer]);
    this.frames = [];
    this.count = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (this.running && input) {
      this.frames.push(input.slice());
      this.count += input.length;
      if (this.count >= 4096) this.flush();
    }
    return true;
  }
}
registerProcessor("signal-source", SignalSource);
registerProcessor("recorder", Recorder);
