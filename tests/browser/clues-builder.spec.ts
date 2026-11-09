import { test, expect } from "@playwright/test";
import { importPack, exportPack } from "./pack-helpers";

const round = { type: "clues", title: "Mystery", startingCoins: 16, questions: [
  { generalClue: { text: "Where?", media: "intro.aac" }, answer: { hint: "Paris", stages: [{ text: "City on the Seine", media: "answer.webm" }] }, clues: [
    { id: "history", category: "History", price: 2, content: { text: "A capital" } },
    { id: "photo", category: "Photo", price: 3, content: { media: "photo.png" } },
    { id: "music", category: "Music", price: 4, content: { text: "Listen", media: "music.mp3" } },
  ] },
] };
const media = ["intro.aac", "answer.webm", "photo.png", "music.mp3"].map((name) => ({ name: `media/${name}`, data: new Uint8Array([1, 2, 3]) }));

for (const width of [1440, 390]) test(`clues stages round-trip and use the text-question layout at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  await importPack(page, [round], media);
  const question = page.getByRole("region", { name: "Clues question 1", exact: true });
  const general = question.getByRole("region", { name: "General clue", exact: true });
  const answer = question.getByRole("region", { name: "Answer", exact: true });
  const paid = question.getByRole("region", { name: "Paid clues", exact: true });
  await expect(page.getByRole("spinbutton", { name: "Starting coins", exact: true })).toHaveValue("16");
  await expect(general.getByRole("textbox")).toHaveValue("Where?");
  await expect(answer.getByRole("textbox", { name: "Answer hint", exact: true })).toHaveValue("Paris");
  await expect(answer.getByPlaceholder("Write your text...")).toHaveValue("City on the Seine");
  await expect(page.getByRole("spinbutton", { name: /points/i })).toHaveCount(0);
  const left = (await general.boundingBox())!, right = (await answer.boundingBox())!, below = (await paid.boundingBox())!;
  if (width === 1440) { expect(left.x).toBeLessThan(right.x); expect(left.y).toBe(right.y); }
  else { expect(left.x).toBe(right.x); expect(left.y).toBeLessThan(right.y); }
  expect(below.y).toBeGreaterThanOrEqual(right.y + right.height);
  const bounds = (await question.boundingBox())!;
  const fields = await question.locator("input,textarea").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
  expect(Math.max(...fields)).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  const original = await exportPack(page);
  expect(original.rounds).toEqual([round]);
  for (const file of media) expect(original.entries.find((entry) => entry.name === file.name)!.data).toEqual(file.data);
  await answer.getByRole("button", { name: "Add answer stage", exact: true }).click();
  await answer.getByPlaceholder("Write your text...").last().fill("An explanation");
  const changed = await exportPack(page);
  expect(changed.rounds[0].questions[0].answer.stages).toEqual([...round.questions[0].answer.stages, { text: "An explanation" }]);
  await importPack(page, changed.rounds, media);
  expect((await exportPack(page)).rounds).toEqual(changed.rounds);
  await page.getByRole("region", { name: "Clues question 1", exact: true }).screenshot({ path: testInfo.outputPath(`clues-builder-${width}.png`) });
});

test("new clues questions default to 16 coins and use stage editors for every content field", async ({ page }) => {
  await page.goto("/build");
  await page.getByRole("button", { name: "Add round", exact: true }).click();
  await page.getByRole("button", { name: "Clues", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Starting coins", exact: true })).toHaveValue("16");
  await page.getByRole("region", { name: "General clue", exact: true }).getByRole("textbox").fill("Who?");
  const answer = page.getByRole("region", { name: "Answer", exact: true });
  await answer.getByRole("textbox", { name: "Answer hint", exact: true }).fill("Ada");
  await answer.getByPlaceholder("Write your text...").fill("Ada Lovelace");
  await page.getByRole("textbox", { name: "Clue category", exact: true }).fill("History");
  await page.getByRole("region", { name: "Paid clue 1", exact: true }).getByPlaceholder("Write your text...").fill("A programmer");
  const { rounds } = await exportPack(page);
  expect(rounds[0].startingCoins).toBe(16);
  expect(rounds[0].questions[0].generalClue).toEqual({ text: "Who?" });
  expect(rounds[0].questions[0].answer).toEqual({ hint: "Ada", stages: [{ text: "Ada Lovelace" }] });
  expect(rounds[0].questions[0].clues[0].content).toEqual({ text: "A programmer" });
});

test("question and paid-clue drag handles reorder exported stages without losing IDs or prices", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const second = { ...round.questions[0], generalClue: { text: "Who?" }, clues: round.questions[0].clues.slice(0, 2) };
  await importPack(page, [{ ...round, questions: [round.questions[0], second] }], media);
  for (const index of [1, 2]) await page.getByRole("button", { name: `Collapse question ${index}`, exact: true }).click();
  await page.getByRole("button", { name: "Reorder question 1", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Reorder question 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await page.locator('[id^="DndLiveRegion"]').allTextContents()).some((message) => {
    const moved = /^Draggable item (.+) was moved over droppable area (.+)\.$/.exec(message);
    return moved !== null && moved[1] !== moved[2];
  })).toBe(true);
  await page.keyboard.press("Space");
  expect((await exportPack(page)).rounds[0].questions.map((question: { generalClue: { text: string } }) => question.generalClue.text)).toEqual(["Who?", "Where?"]);
  await page.getByRole("button", { name: "Expand question 1", exact: true }).click();
  const question = page.getByRole("region", { name: "Clues question 1", exact: true });
  const stageCollapse = question.getByTitle("Collapse", { exact: true });
  for (let remaining = await stageCollapse.count(); remaining > 0; remaining--) await stageCollapse.first().click();
  const first = question.getByRole("button", { name: "Reorder paid clue 1", exact: true });
  const last = question.getByRole("button", { name: "Reorder paid clue 2", exact: true });
  await last.scrollIntoViewIfNeeded();
  const from = (await first.boundingBox())!, to = (await last.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(question.getByRole("textbox", { name: "Clue category", exact: true }).first()).toHaveValue("Photo");
  // Verify the reordered draft is saved before reconnecting and exporting it.
  await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const opening = indexedDB.open("quizee-build");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction("snapshots", "readonly");
      const reading = transaction.objectStore("snapshots").get("build-page");
      reading.onsuccess = () => resolve(reading.result?.rounds?.[0]?.cluesQuestions?.[0]?.clues?.map((clue: { id: string }) => clue.id) ?? []);
      reading.onerror = () => reject(reading.error);
      transaction.oncomplete = () => database.close();
    };
  }))).toEqual(["photo", "history"]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Clues question 1", exact: true })).toBeVisible();
  const result = await exportPack(page);
  expect(result.rounds[0].questions[0].clues).toEqual([...second.clues].reverse());
  await importPack(page, result.rounds, media);
  expect((await exportPack(page)).rounds).toEqual(result.rounds);
});

test("clues import refuses missing stage media, empty stages, and invalid budgets", async ({ page }) => {
  await importPack(page, [round]);
  await expect(page.getByText("Referenced media file is missing in archive: intro.aac", { exact: true })).toBeVisible();
  for (const startingCoins of [0, 1.5]) {
    await importPack(page, [{ ...round, startingCoins }], media);
    const message = startingCoins === 0 ? "Round 1 startingCoins: number outside allowed range." : "Round 1 startingCoins: expected safe whole number.";
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
  await importPack(page, [{ ...round, questions: [{ ...round.questions[0], generalClue: {} }] }], media);
  await expect(page.getByText(/Stage needs text and\/or media/)).toBeVisible();
});
