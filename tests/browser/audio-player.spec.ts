import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createAudioWav } from "./fixtures/audio";


const fixture = createAudioWav();
async function bundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import StageMedia from './lib/components/room/stage-media';
      const root = createRoot(document.getElementById('audio-test'));
      window.renderAudio = (durationSeconds, playbackKey = 'one', playbackActive = true) => root.render(
        <StageMedia url="/__audio.wav" fallbackName="song.wav" alt="Question audio"
          mediaVolume={0.2} durationSeconds={durationSeconds} playbackKey={playbackKey} playbackActive={playbackActive} />);
      window.renderAudio(0.1);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  return result.outputFiles[0].text;
}

type AudioWindow = Window & {
  renderAudio: (duration?: number, key?: string, active?: boolean) => void;
  scheduledAudio: Array<{ offset: number; duration: number }>;
  audioGains: GainNode[];
};

test.beforeEach(async ({ page }) => {
  await page.route("**/__audio-fixture", (route) => route.fulfill({ contentType: "text/html", body: '<html><body><div id="audio-test"></div></body></html>' }));
  await page.route("**/__audio.wav", (route) => route.fulfill({ contentType: "audio/wav", body: fixture }));
  await page.goto("/__audio-fixture");
  await page.evaluate(() => {
    const w = window as unknown as AudioWindow;
    w.scheduledAudio = []; w.audioGains = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      w.scheduledAudio.push({ offset, duration: duration! });
      start.call(this, when, offset, duration!);
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this); w.audioGains.push(gain); return gain;
    };
  });
  await page.addScriptTag({ content: await bundle() });
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("fractional clips schedule a cutoff, display the limit, and replay", async ({ page }) => {
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 0.1s$/);
  await expect(page.getByLabel("Audio position", { exact: true })).toHaveAttribute("max", "0.1");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(page.getByLabel("Audio time")).toHaveText("0.1s / 0.1s");
  expect(await page.evaluate(() => (window as unknown as AudioWindow).scheduledAudio.at(-1))).toEqual({ offset: 0, duration: 0.1 });
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(page.getByLabel("Audio time")).toHaveText("0.1s / 0.1s");
  expect(await page.evaluate(() => (window as unknown as AudioWindow).scheduledAudio.length)).toBeGreaterThanOrEqual(2);
});

test("seeking, rewind, volume, and same-file stage changes", async ({ page }) => {
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio(0.5));
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 0.5s$/);
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByLabel("Audio position", { exact: true }).fill("0.25");
  await expect(page.getByLabel("Audio time")).toHaveText("0.25s / 0.5s");
  await page.getByRole("button", { name: "Rewind audio" }).click();
  await expect(page.getByLabel("Audio position", { exact: true })).toHaveValue("0");
  await page.getByLabel("Audio volume").fill("0.7");
  await expect.poll(() => page.evaluate(() => (window as unknown as AudioWindow).audioGains.at(-1)!.gain.value)).toBeCloseTo(0.7);
  await page.getByRole("button", { name: "Mute audio", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as AudioWindow).audioGains.at(-1)!.gain.value)).toBe(0);
  await page.getByRole("button", { name: "Unmute audio", exact: true }).click();
  await expect(page.getByLabel("Audio volume")).toHaveValue("0.7");
  await page.getByLabel("Audio position", { exact: true }).fill("0.3");
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio(0.5, "two", false));
  await expect(page.getByLabel("Audio position", { exact: true })).toHaveValue("0");
  await expect(page.getByRole("status")).toHaveCount(0);
  const starts = await page.evaluate(() => (window as unknown as AudioWindow).scheduledAudio.length);
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio(0.5, "two", true));
  await expect.poll(() => page.evaluate(() => (window as unknown as AudioWindow).scheduledAudio.length)).toBeGreaterThan(starts);
  await page.getByLabel("Audio position", { exact: true }).fill("0.2");
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio(0.5, "two", false));
  await expect(page.getByLabel("Audio position", { exact: true })).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Play audio", exact: true })).toBeDisabled();
});

test("unlimited audio uses its actual duration and invalid limits fail visibly", async ({ page }) => {
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio());
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 1s$/);
  await page.evaluate(() => (window as unknown as AudioWindow).renderAudio(2));
  await expect(page.getByRole("alert")).toContainText("exceeds the audio length");
  await expect(page.getByRole("button", { name: "Play audio", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Audio time")).toHaveText("0s / 2s");
});
