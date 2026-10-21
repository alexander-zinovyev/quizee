import { test, expect } from "@playwright/test";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";

test("builder imports and exports multi-step AAC clues", async ({ page }) => {
  const path = "music/1_1.aac";
  const rounds = [{
    type: "multi-step", title: "Music", pointsPerStep: [3, 2, 1], allowAnswerChanges: false,
    questions: [{
      steps: [{ media: path }, { text: "Second clue" }, { text: "Third clue" }],
      answer: { hint: "Song", stages: [{ text: "Song" }] },
    }],
  }];
  const audio = new Uint8Array([0xff, 0xf1]);
  const buffer = Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify(rounds)) },
    { name: `media/${path}`, data: audio },
  ]));
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({
    name: "music.tar.gz", mimeType: "application/gzip", buffer,
  });
  await expect(page.getByText("Loaded 1 round(s) and 1 media file(s).", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack" }).click();
  const download = await downloading;
  const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
  expect(JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data))).toEqual(rounds);
  expect(entries.find((entry) => entry.name === `media/${path}`)!.data).toEqual(audio);
});
