import { test, expect, type Page } from "@playwright/test";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";

async function importPack(page: Page, rounds: unknown, media: Array<{ name: string; data: Uint8Array }> = []) {
  const buffer = Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify(rounds)) }, ...media,
  ]));
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "sorting.tar.gz", mimeType: "application/gzip", buffer });
}

async function exportPack(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack" }).click();
  const download = await downloading;
  const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
  return { rounds: JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data)), entries };
}

const round = {
  type: "sorting", title: "Timeline", criterion: "Earliest to latest",
  items: [
    { id: "A", stages: [{ text: "First event" }] },
    { id: "B", stages: [{ media: "clip.aac" }, { text: "An audio event" }] },
    { id: "C", stages: [{ text: "Last event", media: "photo.png" }] },
  ],
  correctOrder: ["B", "A", "C"],
};

test("sorting builder preserves staged text/media and changes the authored order independently", async ({ page }) => {
  const audio = new Uint8Array([0xff, 0xf1]);
  const image = new Uint8Array([0x89, 0x50]);
  await importPack(page, [round], [{ name: "media/clip.aac", data: audio }, { name: "media/photo.png", data: image }]);
  await expect(page.getByText("Loaded 1 round(s) and 2 media file(s).", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sorting criterion" })).toHaveValue(round.criterion);
  await expect(page.getByRole("region", { name: "Sorting item 1", exact: true }).locator("textarea").nth(1)).toHaveValue("An audio event");
  const original = await exportPack(page);
  expect(original.rounds).toEqual([round]);
  expect(original.entries.find((entry) => entry.name === "media/clip.aac")!.data).toEqual(audio);
  expect(original.entries.find((entry) => entry.name === "media/photo.png")!.data).toEqual(image);
  await page.getByRole("button", { name: "Move sorting item 1 down", exact: true }).click();
  const reordered = await exportPack(page);
  expect(reordered.rounds).toEqual([{ ...round, correctOrder: ["A", "B", "C"] }]);
});

test("sorting builder authors a new list with the shared stage editor", async ({ page }) => {
  await page.goto("/build");
  await page.getByRole("button", { name: "Add round", exact: true }).click();
  await page.getByRole("button", { name: "Sorting", exact: true }).click();
  await page.getByRole("textbox", { name: "Sorting criterion" }).fill("Smallest to largest");
  await page.getByRole("region", { name: "Sorting item 1", exact: true }).locator("textarea").fill("Small");
  await page.getByRole("region", { name: "Sorting item 2", exact: true }).locator("textarea").fill("Large");
  await page.getByRole("button", { name: "Move sorting item 1 down", exact: true }).click();
  const { rounds } = await exportPack(page);
  expect(rounds[0].type).toBe("sorting");
  expect(rounds[0].criterion).toBe("Smallest to largest");
  expect(rounds[0].items.map((item: { stages: Array<{ text: string }> }) => item.stages)).toEqual([[{ text: "Small" }], [{ text: "Large" }]]);
  expect(rounds[0].correctOrder).toEqual(rounds[0].items.map((item: { id: string }) => item.id).reverse());
});

test("sorting builder refuses non-permutation orders and missing item media on import", async ({ page }) => {
  await importPack(page, [{ ...round, correctOrder: ["A", "A", "C"] }]);
  await expect(page.getByText(/Sorting order must contain every item ID exactly once/)).toBeVisible();
  await importPack(page, [round]);
  await expect(page.getByText("Referenced media file is missing in archive: clip.aac", { exact: true })).toBeVisible();
});
