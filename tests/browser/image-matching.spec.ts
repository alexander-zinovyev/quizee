import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { editImageMatches, parseImageMatch } from "../../lib/image-matching";

test.use({ colorScheme: "light" });

async function bundle() {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import ImageQuizRound from './lib/components/image-round';
      import { HarnessAuthProvider } from '@/app/providers/firebase-auth-provider';
      import { editImageMatches, parseImageMatch } from './lib/image-matching';
      window.editImageMatches = editImageMatches;
      window.parseImageMatch = parseImageMatch;
      const questions = [
        { id:'uk', prompt:'United Kingdom' }, { id:'sk', prompt:'Slovakia' },
        { id:'si', prompt:'Slovenia' }, { id:'mx', prompt:'Mexico' }
      ];
      const colors = ['#123456','#f03040','#25c39e','#eab308'];
      const images = colors.map((color,index) => ({ id:'image-'+index, alt:'Flag '+(index+1),
        src:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="75"><rect width="150" height="75" fill="'+color+'"/></svg>') }));
      const roots = ['player','teammate'].map(id => createRoot(document.getElementById(id)));
      let generation = 0;
      window.renderImageViews = (reconnect = false, imagesReady = true, mediaOnly = false, longLabels = false) => {
        if (reconnect) generation++;
        const shownImages = longLabels ? Array.from({length:24},(_,index) => ({...images[index % 4],id:'image-'+index})) : images;
        const shownQuestions = longLabels ? Array.from({length:24},(_,index) => ({id:'long-'+index,prompt:'Long description '+(index+1)+': a detailed description that needs several lines in a narrow interactive panel'}))
          : mediaOnly ? questions.map((question,index) => index === 2 ? {id:question.id,media:{storagePath:images[2].src}} : question) : questions;
        flushSync(() => roots.forEach((root,index) => root.render(
          <HarnessAuthProvider uid={'player-'+index}>
            <ImageQuizRound key={generation} roomSlug="demo" teamId="red" roundId="images"
              questions={shownQuestions} images={imagesReady ? shownImages : []} />
          </HarnessAuthProvider>)));
      };
      window.renderImageViews(false, window.imageInitialImagesReady !== false);` },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "matching-transport", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/firestore|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "matching-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "matching-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/');
          export const collection = doc;
          export const onSnapshot = (path,options,callback,error) => window.imageTransport.subscribe(path,callback,error);
          export const runTransaction = (_,callback) => window.imageTransport.transaction(callback);` };
        if (args.path.includes("firebase-auth-provider")) return { resolveDir: process.cwd(), contents: `
          import React from 'react';
          const Auth = React.createContext('unknown');
          export const HarnessAuthProvider = ({uid,children}) => React.createElement(Auth.Provider,{value:uid},children);
          export const useFirebaseAuth = () => ({user:{uid:React.useContext(Auth)}});` };
        return { contents: `export const getClientFirestore = () => ({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Match = { answer: string; locked: boolean; user?: string | null };
type Harness = {
  renderImageViews: (reconnect?: boolean, imagesReady?: boolean, mediaOnly?: boolean, longLabels?: boolean) => void;
  imageInitialImagesReady: boolean;
  imageTransport: {
    subscribe: (path: string, callback: (snapshot: unknown) => void, error: (value: unknown) => void) => () => void;
    transaction: (callback: (transaction: unknown) => Promise<unknown>) => Promise<unknown>;
    saved: () => Record<string, Match>;
    remove: (id: string) => void;
    close: () => void;
    fail: () => void;
    pause: () => void;
    resume: () => void;
    writes: Array<Record<string, Match>>;
  };
};
const zone = (panel: Locator, index: number) => panel.getByRole("button", { name: new RegExp(`^Drop description for image ${index}:`) });
const select = (panel: Locator, label: string) => panel.getByRole("button", { name: `Select description: ${label}`, exact: true });

async function setup(page: Page, options: { deferImages?: boolean; saved?: Record<string, Match> } = {}) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__image-matching", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main><section aria-label="Player view" id="player" style="height:380px;width:min(760px,calc(100vw - 24px));margin:12px"></section><section aria-label="Teammate view" id="teammate" style="height:380px;width:min(760px,calc(100vw - 24px));margin:12px"></section></main></body></html>` }));
  await page.goto("/__image-matching");
  await page.evaluate((options) => {
    const w = window as unknown as Harness;
    const base = "rooms/demo/teams/red/rounds/images/answers";
    const docs: Record<string, Match> = structuredClone(options.saved ?? {});
    const listeners = new Set<(snapshot: unknown) => void>();
    const snapshot = () => ({ metadata: { fromCache: false }, forEach: (callback: (doc: { id: string; data: () => Match }) => void) => {
      Object.entries(docs).forEach(([id, value]) => callback({ id, data: () => structuredClone(value) }));
    } });
    const emit = () => { if (!paused) listeners.forEach((callback) => callback(snapshot())); };
    let queue = Promise.resolve<unknown>(undefined), state = "active", failNext = false, paused = false;
    const writes: Array<Record<string, Match>> = [];
    w.imageTransport = {
      subscribe: (path, callback) => {
        if (path !== base) throw new Error("Unexpected image answer subscription.");
        listeners.add(callback);
        queueMicrotask(() => { if (listeners.has(callback)) callback(snapshot()); });
        return () => { listeners.delete(callback); };
      },
      transaction: (callback) => {
        const result = queue.then(async () => {
          if (failNext) { failNext = false; throw new Error("Image matches were not saved."); }
          const changes: Record<string, Match> = {};
          const value = await callback({
            get: async (path: string) => ({ data: () => path === "rooms/demo/rounds/images" ? { state }
              : structuredClone(docs[path.slice(base.length + 1)]) }),
            set: (path: string, value: Match, options: { merge: boolean }) => {
              if (!path.startsWith(base + "/") || !options.merge) throw new Error("Matching must preserve existing answer documents.");
              changes[path.slice(base.length + 1)] = value;
            },
          });
          Object.assign(docs, changes);
          writes.push(structuredClone(changes));
          emit();
          return value;
        });
        queue = result.catch(() => undefined);
        return result;
      },
      saved: () => structuredClone(docs), remove: (id) => { delete docs[id]; emit(); },
      close: () => { state = "closed"; }, fail: () => { failNext = true; }, writes,
      pause: () => { paused = true; }, resume: () => { paused = false; emit(); },
    };
    w.imageInitialImagesReady = !options.deferImages;
  }, options);
  await page.addScriptTag({ content: await bundle() });
  const player = page.getByRole("region", { name: "Player view", exact: true });
  const teammate = page.getByRole("region", { name: "Teammate view", exact: true });
  if (!options.deferImages && !options.saved) await expect(select(player, "United Kingdom")).toBeEnabled();
  return { player, teammate };
}

for (const width of [1440, 390]) test(`labels match dropzones below images and preserve shared assignments at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  const { player, teammate } = await setup(page);
  const image = player.getByRole("img", { name: "Flag 1", exact: true });
  const imageBounds = (await image.boundingBox())!, dropBounds = (await zone(player, 1).boundingBox())!;
  expect(dropBounds.y).toBeGreaterThan(imageBounds.y + imageBounds.height);
  // Images are references; only the description dropzones accept matching.
  await select(player, "United Kingdom").dragTo(player.getByRole("button", { name: "Zoom image 1", exact: true }));
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.writes.length)).toBe(0);
  await select(player, "United Kingdom").dragTo(zone(player, 1));
  await expect(zone(player, 1)).toHaveText("United Kingdom");
  await expect(zone(teammate, 1)).toHaveText("United Kingdom");
  await expect(select(player, "United Kingdom")).toHaveCount(0);

  // Replacing an occupied destination persists both question documents atomically.
  await select(teammate, "Slovakia").click();
  await zone(teammate, 1).click();
  await expect(zone(player, 1)).toHaveText("Slovakia");
  await expect(select(player, "United Kingdom")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.saved())).toMatchObject({
    uk: { answer: "", locked: false }, sk: { answer: "image-0", locked: false },
  });
  const writes = await page.evaluate(() => (window as unknown as Harness).imageTransport.writes);
  expect(Object.keys(writes[1]).sort()).toEqual(["sk", "uk"]);

  // Keyboard selection moves an assigned label, preserving the grading contract.
  await zone(player, 1).focus();
  await page.keyboard.press("Enter");
  await zone(player, 3).focus();
  await page.keyboard.press("Enter");
  await expect(zone(teammate, 1)).toHaveText("Unassigned");
  await expect(zone(teammate, 3)).toHaveText("Slovakia");
  await page.evaluate(() => (window as unknown as Harness).renderImageViews(true));
  await expect(zone(player, 3)).toHaveText("Slovakia");
  await expect(zone(teammate, 3)).toHaveText("Slovakia");
  const lock = player.getByRole("button", { name: "Lock match for image 3", exact: true });
  await player.locator('[data-image-id="image-2"]').hover();
  await lock.click();
  await expect(zone(teammate, 3)).toBeDisabled();
  await expect(teammate.getByRole("button", { name: "Clear match for image 3", exact: true })).toBeDisabled();
  await player.locator('[data-image-id="image-2"]').hover();
  await player.getByRole("button", { name: "Edit match for image 3", exact: true }).click();
  await expect(zone(teammate, 3)).toBeEnabled();
  await teammate.locator('[data-image-id="image-2"]').hover();
  await teammate.getByRole("button", { name: "Clear match for image 3", exact: true }).click();
  await expect(zone(player, 3)).toHaveText("Unassigned");
  await expect(select(player, "Slovakia")).toBeVisible();

  await player.getByRole("button", { name: "Zoom image 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Flag 1", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Flag 1", exact: true })).toHaveAttribute("src", (await image.getAttribute("src"))!);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await player.screenshot({ path: testInfo.outputPath("image-matching.png") });
});

test("failed saves roll back, removed snapshots clear matches, and a closed round refuses writes", async ({ page }) => {
  const { player, teammate } = await setup(page);
  await page.evaluate(() => (window as unknown as Harness).imageTransport.fail());
  await select(player, "United Kingdom").click();
  await zone(player, 1).click();
  await expect(player.getByRole("alert")).toContainText("Image matches were not saved.");
  await expect(zone(player, 1)).toHaveText("Unassigned");
  await player.getByRole("button", { name: "Dismiss", exact: true }).click();
  await select(player, "United Kingdom").click();
  await zone(player, 1).click();
  await expect(zone(teammate, 1)).toHaveText("United Kingdom");
  await page.evaluate(() => (window as unknown as Harness).imageTransport.remove("uk"));
  await expect(zone(player, 1)).toHaveText("Unassigned");
  await expect(select(teammate, "United Kingdom")).toBeVisible();
  await page.evaluate(() => (window as unknown as Harness).imageTransport.close());
  await select(player, "United Kingdom").click();
  await zone(player, 1).click();
  await expect(player.getByRole("alert")).toContainText("The image round is closed.");
  await expect(zone(player, 1)).toHaveText("Unassigned");
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.saved())).toEqual({});
});

test("saved matches wait for image metadata and media descriptions remain inspectable before matching", async ({ page }) => {
  const { player, teammate } = await setup(page, { deferImages: true, saved: { uk: { answer: "image-0", locked: true } } });
  await expect(select(player, "United Kingdom")).toBeDisabled();
  await expect(player.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Harness).renderImageViews(false, true, true));
  await expect(zone(player, 1)).toHaveText("United Kingdom");
  await expect(zone(player, 1)).toBeDisabled();
  await expect(player.getByRole("alert")).toHaveCount(0);
  await expect(teammate.getByRole("alert")).toHaveCount(0);
  const instructions = await zone(player, 1).getAttribute("aria-describedby");
  expect(instructions).not.toBe(await zone(teammate, 1).getAttribute("aria-describedby"));
  await expect(player.locator(`[id="${instructions}"]`)).toHaveCount(1);
  await expect(player.getByRole("img", { name: "Description media 3", exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Zoom description media 3", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Description media 3", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await select(player, "Description 3").click();
  await zone(player, 3).click();
  await expect(zone(teammate, 3)).toHaveText("Description 3");
  await expect(teammate.getByRole("img", { name: "Description media 3", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.saved())).toMatchObject({ si: { answer: "image-2" } });
});

test("stale teammate views cannot duplicate an image or replace a locked match", async ({ page }) => {
  const { player, teammate } = await setup(page);
  await page.evaluate(() => (window as unknown as Harness).imageTransport.pause());
  await select(player, "United Kingdom").click();
  await zone(player, 1).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).imageTransport.saved().uk?.answer)).toBe("image-0");
  await expect(zone(teammate, 1)).toHaveText("Unassigned");
  await select(teammate, "Slovakia").click();
  await zone(teammate, 1).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).imageTransport.saved().sk?.answer)).toBe("image-0");
  await page.evaluate(() => (window as unknown as Harness).imageTransport.resume());
  await expect(zone(player, 1)).toHaveText("Slovakia");
  await expect(select(player, "United Kingdom")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.saved().uk.answer)).toBe("");
  await page.evaluate(() => (window as unknown as Harness).imageTransport.pause());
  await player.locator('[data-image-id="image-0"]').hover();
  await player.getByRole("button", { name: "Lock match for image 1", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).imageTransport.saved().sk.locked)).toBe(true);
  await expect(zone(teammate, 1)).toBeEnabled();
  await select(teammate, "United Kingdom").click();
  await zone(teammate, 1).click();
  await expect(teammate.getByRole("alert")).toContainText("Unlock the destination match before replacing it.");
  await page.evaluate(() => (window as unknown as Harness).imageTransport.resume());
  await expect(zone(teammate, 1)).toHaveText("Slovakia");
  await expect(zone(teammate, 1)).toBeDisabled();
});

test("matching edits retain grading IDs, refuse malformed values, and preserve locked sources", () => {
  const ids = ["q1", "q2"], images = ["i1", "i2"];
  const current = { q1: { answer: "i1", locked: true }, q2: { answer: "i2", locked: false } };
  expect(() => editImageMatches(current, { type: "assign", questionId: "q1", imageId: "i2" }, ids, images)).toThrow("Unlock the match");
  expect(() => editImageMatches(current, { type: "clear", questionId: "q1" }, ids, images)).toThrow("Unlock the match");
  expect(() => editImageMatches(current, { type: "assign", questionId: "q2", imageId: "i1" }, ids, images)).toThrow("Unlock the destination");
  expect(() => editImageMatches(current, { type: "assign", questionId: "missing", imageId: "i1" }, ids, images)).toThrow("Unknown image description");
  expect(() => editImageMatches(current, { type: "assign", questionId: "q2", imageId: "missing" }, ids, images)).toThrow("Unknown matching image");
  for (const malformed of [null, {}, { answer: "missing" }, { answer: "i1", locked: "true" }]) expect(() => parseImageMatch(malformed, images)).toThrow("Invalid saved image match");
  expect(parseImageMatch(undefined, images)).toEqual({ answer: "", locked: false });
  expect(current).toEqual({ q1: { answer: "i1", locked: true }, q2: { answer: "i2", locked: false } });
});

test("many long descriptions leave both images and the description bank usable in a short narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { player } = await setup(page);
  await page.evaluate(() => (window as unknown as Harness).renderImageViews(false, true, false, true));
  const bank = player.locator('[aria-label="Available descriptions"]');
  const grid = player.locator('[aria-label="Matching images"]');
  const bounds = (await player.boundingBox())!, bankBounds = (await bank.boundingBox())!;
  expect(bankBounds.height).toBeLessThanOrEqual(bounds.height * 0.35 + 1);
  expect((await grid.locator("..").boundingBox())!.height).toBeGreaterThan(bounds.height * 0.6);
  expect(await bank.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await bank.getByRole("button", { name: /^Select description: Long description 24:/ }).click();
  await zone(player, 1).click();
  await expect(zone(player, 1)).toContainText("Long description 24:");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("legacy duplicate saved assignments fail visibly instead of hiding a description", async ({ page }) => {
  const { player, teammate } = await setup(page, { saved: {
    uk: { answer: "image-0", locked: false }, sk: { answer: "image-0", locked: false },
  } });
  for (const panel of [player, teammate]) {
    await expect(panel.getByRole("alert")).toContainText("Duplicate saved image assignments.");
    await expect(panel.getByRole("alert")).toContainText("Ask the host");
    await expect(select(panel, "United Kingdom")).toBeDisabled();
    await expect(select(panel, "Slovakia")).toBeDisabled();
  }
  expect(await page.evaluate(() => (window as unknown as Harness).imageTransport.writes)).toEqual([]);
});
