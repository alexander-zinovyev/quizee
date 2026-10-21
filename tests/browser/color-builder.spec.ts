import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";
import { parseColorSvg } from "../../lib/media/color-svg";

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

async function svgPack(regionIds = ["left", "right"], extra = "") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" style="fill:#FFFFFF"/><rect id="left" x="10" y="10" width="20" height="40" fill="red" style="fill:#4285F4!important;fill:blue;stroke:none"/><rect id="right" x="60" y="10" width="20" height="40" style="fill:#4285F4"/>${extra}</svg>`;
  return Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify([{ type: "color", title: "Vector Colors", scoring: { mode: "threshold" }, questions: [{ image: "logo.svg", regionIds, initialColor: "#83C547", targetColor: "#4285F4" }] }])) },
    { name: "media/logo.svg", data: new TextEncoder().encode(svg) },
  ]));
}

for (const width of [1440, 390]) test(`builder edits SVG regions and exports at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "vectors.tar.gz", mimeType: "application/gzip", buffer: await svgPack() });
  await expect(page.getByText("Loaded 1 round(s) and 1 media file(s).")).toBeVisible();
  await expect(page.getByLabel("SVG region 1")).toHaveValue("left");
  await expect(page.getByLabel("SVG region 2")).toHaveValue("right");
  await expect(page.getByRole("button", { name: "Add region", exact: true })).toBeDisabled();
  await expect(page.getByLabel("SVG region 1").locator('option[value="right"]')).toHaveCount(0);
  await expect(page.getByText("Mask", { exact: true })).toHaveCount(0);
  const preview = page.getByRole("img", { name: "Question preview" });
  await expect(preview.locator('rect[id$="-left"]')).toHaveAttribute("fill", "#83C547");
  await expect(preview.locator('rect[id$="-right"]')).toHaveAttribute("fill", "#83C547");
  await expect(preview.locator('rect[style]')).toHaveCount(0);
  const bounds = (await preview.boundingBox())!;
  expect(Math.abs(bounds.height - bounds.width * 60 / 100)).toBeLessThan(1);
  await page.getByRole("button", { name: "Remove region 2", exact: true }).click();
  await expect(preview.locator('rect[id$="-right"]')).toHaveAttribute("fill", "#4285F4");
  await page.getByLabel("SVG region 1").selectOption("right");
  await expect(preview.locator('rect[id$="-left"]')).toHaveAttribute("fill", "#4285F4");
  await expect(preview.locator('rect[id$="-right"]')).toHaveAttribute("fill", "#83C547");
  await page.getByRole("button", { name: "Add region", exact: true }).click();
  await expect(page.getByLabel("SVG region 2")).toHaveValue("left");
  await page.getByRole("button", { name: "Remove region 1", exact: true }).click();
  await page.getByRole("button", { name: "Target", exact: true }).click();
  await page.getByLabel("Target HEX color").fill("#FF0000");
  await expect(preview.locator('rect[id$="-left"]')).toHaveAttribute("fill", "#FF0000");
  await expect(preview.locator('rect:not([id])')).toHaveAttribute("fill", "#FFFFFF");
  await page.screenshot({ path: testInfo.outputPath(`svg-builder-${width}.png`), fullPage: true });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack" }).click();
  const download = await downloading;
  const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
  const exported = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data));
  expect(exported[0].questions[0].regionIds).toEqual(["left"]);
  expect(exported[0].questions[0].mask).toBeUndefined();
  expect(exported[0].questions[0].targetColor).toBe("#FF0000");
  await page.getByRole("button", { name: "Remove region 1", exact: true }).click();
  await page.getByRole("button", { name: "Generate pack" }).click();
  await expect(page.getByText(/regionIds must be a nonempty array/)).toBeVisible();
  await page.getByRole("button", { name: "Add region", exact: true }).click();
  await expect(page.getByLabel("SVG region 1")).toHaveValue("left");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("builder refuses unknown SVG regions and active content", async ({ page }) => {
  await page.goto("/build");
  const input = page.locator('input[accept=".tar.gz,application/gzip"]');
  await input.setInputFiles({ name: "missing.tar.gz", mimeType: "application/gzip", buffer: await svgPack(["missing"]) });
  await expect(page.getByText(/must identify a visible flat-fill/)).toBeVisible();
  await input.setInputFiles({ name: "script.tar.gz", mimeType: "application/gzip", buffer: await svgPack(["left"], "<script>alert(1)</script>") });
  await expect(page.getByText(/Unsupported SVG element: script/)).toBeVisible();
  await input.setInputFiles({ name: "external-style.tar.gz", mimeType: "application/gzip", buffer: await svgPack(["left"], '<rect style="fill:url(https://example.com/paint)"/>') });
  await expect(page.getByText(/references must be local IDs/)).toBeVisible();
  await input.setInputFiles({ name: "unsupported-style.tar.gz", mimeType: "application/gzip", buffer: await svgPack(["left"], '<rect style="filter:blur(2px)"/>') });
  await expect(page.getByText(/Unsupported SVG inline style property: filter/)).toBeVisible();
});

for (const width of [1440, 390]) test(`builder imports and exports third-party SVG logos at ${width}px`, async ({ page }, testInfo) => {
  const names = ["harley", "jurassic", "mastercard", "mcdonalds", "olympic", "playstation", "redbull", "slack"];
  const sources = await Promise.all(names.map((name) => readFile(`tests/fixtures/color-svg/${name}.svg`)));
  const questions = sources.map((source, index) => ({ image: `${names[index]}.svg`, regionIds: [parseColorSvg(source.toString()).eligibleRegionIds[0]], initialColor: "#83C547", targetColor: "#4285F4" }));
  const quiz = [{ type: "color", title: "Logo Colors", scoring: { mode: "closest" }, questions }];
  const pack = Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify(quiz)) },
    ...sources.map((data, index) => ({ name: `media/${names[index]}.svg`, data })),
  ]));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "logos.tar.gz", mimeType: "application/gzip", buffer: pack });
  await expect(page.getByText("Loaded 1 round(s) and 8 media file(s).")).toBeVisible();
  await expect(page.getByRole("img", { name: "Question preview", exact: true })).toHaveCount(8);
  await expect(page.getByText("Select at least one valid SVG region.", { exact: true })).toHaveCount(0);
  const selectors = page.getByLabel("SVG region 1", { exact: true });
  for (let index = 0; index < names.length; index++) await expect(selectors.nth(index)).toHaveValue(questions[index].regionIds[0]);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack", exact: true }).click();
  const entries = readTarEntries(gunzipSync(await readFile((await (await downloading).path())!)));
  const exported = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data));
  expect(exported[0].questions.map((question: { regionIds: string[] }) => question.regionIds)).toEqual(questions.map((question) => question.regionIds));
  for (let index = 0; index < names.length; index++) expect(Buffer.from(entries.find((entry) => entry.name === `media/${names[index]}.svg`)!.data)).toEqual(sources[index]);
  await page.screenshot({ path: testInfo.outputPath(`logo-builder-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
