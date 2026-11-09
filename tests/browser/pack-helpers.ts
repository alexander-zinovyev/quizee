import { type Page } from "@playwright/test";
import { gunzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createTarGz } from "../../lib/build/tar-gz";
import { readTarEntries } from "../../lib/build/tar-reader";

export async function importPack(page: Page, rounds: unknown, media: Array<{ name: string; data: Uint8Array }> = []) {
  const buffer = Buffer.from(createTarGz([
    { name: "quiz.json", data: new TextEncoder().encode(JSON.stringify(rounds)) }, ...media,
  ]));
  await page.goto("/build");
  await page.locator('input[accept=".tar.gz,application/gzip"]').setInputFiles({ name: "quiz.tar.gz", mimeType: "application/gzip", buffer });
}

export async function exportPack(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate pack" }).click();
  const download = await downloading;
  const entries = readTarEntries(gunzipSync(await readFile((await download.path())!)));
  return { rounds: JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "quiz.json")!.data)), entries };
}
