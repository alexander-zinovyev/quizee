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
  questions: [
    { id: "A", text: "First event" },
    { id: "B", media: "clip.aac", text: "An audio event" },
    { id: "C", text: "Last event", media: "photo.png" },
  ],
  correctOrder: ["B", "A", "C"],
};

test("sorting builder preserves single-stage questions and changes the authored order independently", async ({ page }) => {
  const audio = new Uint8Array([0xff, 0xf1]);
  const image = new Uint8Array([0x89, 0x50]);
  await importPack(page, [round], [{ name: "media/clip.aac", data: audio }, { name: "media/photo.png", data: image }]);
  await expect(page.getByText("Loaded 1 round(s) and 2 media file(s).", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sorting criterion" })).toHaveValue(round.criterion);
  await expect(page.getByRole("region", { name: "Sorting question 1", exact: true }).locator("textarea")).toHaveValue("An audio event");
  await expect(page.getByRole("button", { name: "Add item stage", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Sorting question 1", exact: true }).locator("textarea")).toHaveCount(1);
  const original = await exportPack(page);
  expect(original.rounds).toEqual([round]);
  expect(original.entries.find((entry) => entry.name === "media/clip.aac")!.data).toEqual(audio);
  expect(original.entries.find((entry) => entry.name === "media/photo.png")!.data).toEqual(image);
  await page.getByRole("button", { name: "Move sorting question 1 down", exact: true }).click();
  const reordered = await exportPack(page);
  expect(reordered.rounds).toEqual([{ ...round, correctOrder: ["A", "B", "C"] }]);
});

test("sorting builder authors a new list with the shared stage editor", async ({ page }) => {
  await page.goto("/build");
  await page.getByRole("button", { name: "Add round", exact: true }).click();
  await page.getByRole("button", { name: "Sorting", exact: true }).click();
  await page.getByRole("textbox", { name: "Sorting criterion" }).fill("Smallest to largest");
  await page.getByRole("region", { name: "Sorting question 1", exact: true }).locator("textarea").fill("Small");
  await page.getByRole("region", { name: "Sorting question 2", exact: true }).locator("textarea").fill("Large");
  await page.getByRole("button", { name: "Move sorting question 1 down", exact: true }).click();
  const { rounds } = await exportPack(page);
  expect(rounds[0].type).toBe("sorting");
  expect(rounds[0].criterion).toBe("Smallest to largest");
  expect(rounds[0].questions.map((question: { text: string }) => question.text)).toEqual(["Small", "Large"]);
  expect(rounds[0].correctOrder).toEqual(rounds[0].questions.map((question: { id: string }) => question.id).reverse());
});

test("sorting builder refuses non-permutation orders and missing item media on import", async ({ page }) => {
  await importPack(page, [{ ...round, correctOrder: ["A", "A", "C"] }]);
  await expect(page.getByText(/Sorting order must contain every item ID exactly once/)).toBeVisible();
  await importPack(page, [round]);
  await expect(page.getByText("Referenced media file is missing in archive: clip.aac", { exact: true })).toBeVisible();
});

test("sorting builder rejects the obsolete nested item/stages shape", async ({ page }) => {
  const { questions, ...metadata } = round;
  await importPack(page, [{ ...metadata, items: questions.map(({ id, ...stage }) => ({ id, stages: [stage] })) }]);
  await expect(page.getByText(/Invalid sorting round/)).toBeVisible();
});
