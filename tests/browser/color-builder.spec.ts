import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";

async function pack(maskWidth = 64) {
  const image = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#4285F4" } }).png().toBuffer();
  const mask = await sharp({ create: { width: maskWidth, height: 64, channels: 4, background: "white" } }).png().toBuffer();
  return Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify([{ type: "color", title: "True Colors", scoring: { mode: "closest", points: 1, tieTolerance: 0.05 }, questions: [{ image: "logo.png", mask: "mask.png", initialColor: "#83C547", targetColor: "#4285F4" }] }])) },
    { name: "media/logo.png", data: image }, { name: "media/mask.png", data: mask },
  ]));
}

for (const width of [1440, 390]) test(`builder previews and exports color round at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "colors.tar.gz", mimeType: "application/gzip", buffer: await pack() });
  await expect(page.getByText("Loaded 1 round(s) and 2 media file(s).")).toBeVisible();
  await expect(page.getByLabel("Initial HEX color")).toHaveValue("#83C547");
  await expect(page.getByLabel("Scoring mode")).toHaveValue("closest");
  const canvas = page.getByRole("img", { name: "Question preview" });
  const pixel = () => canvas.evaluate((element) => [...(element as HTMLCanvasElement).getContext("2d")!.getImageData(32, 32, 1, 1).data]);
  await expect.poll(pixel).toEqual([131, 197, 71, 255]);
  await page.getByRole("button", { name: "Target", exact: true }).click();
  await expect.poll(pixel).toEqual([66, 133, 244, 255]);
  await page.getByLabel("Target HEX color").fill("#FF0000");
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.screenshot({ path: testInfo.outputPath(`builder-${width}.png`), fullPage: true });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack" }).click();
  const download = await downloading;
  const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
  const exported = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data));
  expect(exported[0].questions[0].targetColor).toBe("#FF0000");
  expect(exported[0].scoring.mode).toBe("closest");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("builder refuses masks with mismatched dimensions", async ({ page }) => {
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "invalid.tar.gz", mimeType: "application/gzip", buffer: await pack(32) });
  await expect(page.getByText("Color question 1: Image and mask dimensions must match.")).toBeVisible();
});
