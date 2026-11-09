import { test, expect } from "@playwright/test";
import { importPack, exportPack } from "./pack-helpers";

const round = { type: "clues", title: "Mystery", startingCoins: 5, questions: [
  { prompt: "Where?", answer: "Paris", clues: [
    { id: "history", category: "History", price: 2, text: "A capital" },
    { id: "photo", category: "Photo", price: 3, text: "The skyline", image: "photo.png" },
  ] },
] };
test("clues builder preserves coin settings and text/image clues through export and re-import", async ({ page }) => {
  const media = new Uint8Array([0x89, 0x50]);
  await importPack(page, [round], [{ name: "media/photo.png", data: media }]);
  await expect(page.getByRole("spinbutton", { name: "Starting coins", exact: true })).toHaveValue("5");
  await expect(page.getByRole("textbox", { name: "Question prompt", exact: true })).toHaveValue("Where?");
  await expect(page.getByRole("textbox", { name: "Accepted answer", exact: true })).toHaveValue("Paris");
  await expect(page.getByRole("spinbutton", { name: /points/i })).toHaveCount(0);
  const result = await exportPack(page);
  expect(result.rounds).toEqual([round]);
  expect(result.entries.find((entry) => entry.name === "media/photo.png")!.data).toEqual(media);
  await page.getByRole("spinbutton", { name: "Starting coins", exact: true }).fill("8");
  await page.getByRole("spinbutton", { name: "Coin price", exact: true }).first().fill("4");
  const changed = await exportPack(page);
  expect(changed.rounds[0].startingCoins).toBe(8);
  expect(changed.rounds[0].questions[0].clues[0].price).toBe(4);
  await importPack(page, changed.rounds, [{ name: "media/photo.png", data: media }]);
  expect((await exportPack(page)).rounds).toEqual(changed.rounds);
});
test("clues builder authors questions and refuses zero or fractional coins", async ({ page }) => {
  await page.goto("/build");
  await page.getByRole("button", { name: "Add round", exact: true }).click();
  await page.getByRole("button", { name: "Clues", exact: true }).click();
  await page.getByRole("textbox", { name: "Question prompt", exact: true }).fill("Who?");
  await page.getByRole("textbox", { name: "Accepted answer", exact: true }).fill("Ada");
  await page.getByRole("textbox", { name: "Clue category", exact: true }).fill("History");
  await page.getByRole("textbox", { name: "Clue text", exact: true }).fill("A programmer");
  const authored = await exportPack(page);
  expect(authored.rounds[0].type).toBe("clues");
  for (const startingCoins of [0, 1.5]) {
    await importPack(page, [{ ...round, startingCoins }]);
    const message = startingCoins === 0 ? "Round 1 startingCoins: number outside allowed range." : "Round 1 startingCoins: expected safe whole number.";
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
});

test("clues import refuses missing referenced images", async ({ page }) => {
  await importPack(page, [round]);
  await expect(page.getByText("Referenced media file is missing in archive: photo.png", { exact: true })).toBeVisible();
});
