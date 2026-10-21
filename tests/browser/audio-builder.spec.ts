import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "fflate";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";
import { createAudioWav } from "./fixtures/audio";

type RoundType = "text" | "multi-step" | "image";
function pack(type: RoundType) {
  const stages = [0.1, 0.5].map((durationSeconds) => ({ media: { path: "song.wav", durationSeconds } }));
  const answer = { hint: "Song", stages: [{ media: { path: "song.wav", durationSeconds: 0.75 } }] };
  const question = type === "image" ? { image: "image.png", prompt: stages[0] }
    : type === "text" ? { prompt: { stages }, answer } : { steps: stages, answer };
  const quiz = [{ type, title: "Audio", questions: [question], ...(type === "multi-step" ? { pointsPerStep: [2, 1], allowAnswerChanges: true } : {}) }];
  return Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify(quiz)) },
    { name: "media/song.wav", data: createAudioWav() },
    ...(type === "image" ? [{ name: "media/image.png", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }] : []),
  ]));
}

for (const type of ["text", "multi-step", "image"] as const) {
  test(`builder imports, edits, exports, and restores ${type} audio limits`, async ({ page }) => {
    await page.goto("/build");
    await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "audio.tar.gz", mimeType: "application/gzip", buffer: pack(type) });
    await expect(page.getByText(/Loaded 1 round/)).toBeVisible();
    const limits = page.getByLabel("Playback limit (seconds)");
    await expect(limits).toHaveCount(type === "image" ? 1 : 3);
    await expect(limits.first()).toHaveValue("0.1");
    if (type !== "image") {
      await expect(limits.nth(1)).toHaveValue("0.5");
      await expect(limits.nth(2)).toHaveValue("0.75");
    }
    await limits.first().fill("0.2");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Generate pack" }).click();
    const entries = readTarEntries(gunzipSync(await readFile((await (await downloading).path())!)));
    const exported = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data));
    const question = exported[0].questions[0];
    const first = type === "image" ? question.prompt : type === "text" ? question.prompt.stages[0] : question.steps[0];
    expect(first.media).toEqual({ path: "song.wav", durationSeconds: 0.2 });
    if (type !== "image") expect(question.answer.stages[0].media.durationSeconds).toBe(0.75);
    // Saving is debounced; reload only after the edited snapshot is committed.
    await expect.poll(() => page.evaluate(() => new Promise<number | undefined>((resolve, reject) => {
      const open = indexedDB.open("quizee-build", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction("snapshots", "readonly").objectStore("snapshots").get("build-page");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const round = read.result?.rounds?.[0];
          resolve(round?.textQuestions?.[0]?.promptStages?.[0]?.durationSeconds
            ?? round?.multiStepQuestions?.[0]?.steps?.[0]?.durationSeconds
            ?? round?.imageItems?.[0]?.answerStage?.durationSeconds);
          db.close();
        };
      };
    }))).toBe(0.2);
    await page.reload();
    await expect(page.getByLabel("Playback limit (seconds)").first()).toHaveValue("0.2");
  });
}

for (const width of [390, 1440]) test(`audio preview uses the custom limited player at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "audio.tar.gz", mimeType: "application/gzip", buffer: pack("text") });
  await expect(page.getByText(/Loaded 1 round/)).toBeVisible();
  await page.getByRole("button", { name: "Preview question", exact: true }).click();
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 0.1s$/);
  await expect(page.getByRole("button", { name: "Play audio", exact: true })).toBeEnabled();
  await expect(page.locator("audio[controls]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath(`audio-preview-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTitle("Next page", { exact: true }).click();
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 0.5s$/);
  await page.getByRole("button", { name: "Show answer preview" }).click();
  const answerPlayer = page.getByRole("group", { name: "Answer media", exact: true });
  await expect(answerPlayer.getByLabel("Audio time")).toHaveText(/\/ 0.75s$/);
  await expect(answerPlayer.getByRole("button", { name: "Play audio", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Hide answer preview" }).click();
  await expect(page.getByLabel("Audio time")).toHaveText(/\/ 0.5s$/);
});
