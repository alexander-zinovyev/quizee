import { test, expect } from "@playwright/test";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";

for (const width of [1440, 390]) test(`builder imports and exports wagers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const round = { type: "text", title: "Wagers", allowWager: true, questions: [
    { prompt: { stages: [{ text: "Capital?" }] }, answer: { hint: "Paris", stages: [{ text: "Paris" }] } },
  ] };
  const buffer = Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify([round])) },
  ]));
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "wagers.tar.gz", mimeType: "application/gzip", buffer });
  const checkbox = page.getByRole("checkbox", { name: "Double or nothing", exact: true });
  await expect(checkbox).toBeChecked();
  for (const enabled of [false, true]) {
    await checkbox.setChecked(enabled);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Generate pack" }).click();
    const download = await downloading;
    const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
    const exported = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data));
    expect(exported[0].allowWager ?? false).toBe(enabled);
    expect(exported[0].questions).toEqual(round.questions);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
