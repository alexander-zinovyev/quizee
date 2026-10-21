import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";

test.use({ hasTouch: true });

type Harness = Window & {
  renderColor: (host: boolean, state: "active" | "closed", reveal?: boolean) => void;
  setTeamColor: (team: string, color: string) => void;
  setTeamLocked: (team: string, locked: boolean) => void;
  colorReads: string[];
  colorAssetReads: string[];
  gradeTeamColor: (team: string, perceptionScore: number, awardedPoints: number) => void;
  colorWrites: Array<{ teamId: string; answer?: string; locked?: boolean }>;
  getTeamColor: (team: string) => string;
  rejectNextColorWrite: boolean;
};

async function bundle(format: "raster" | "svg") {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ColorPresenting } from './lib/components/color-presenting';
      const root = createRoot(document.getElementById('color-test'));
      window.renderColor = (host, state, reveal = false) => {
        if (state === 'closed') window.freezeColorAnswers();
        root.render(
        <ColorPresenting key={host ? 'host' : 'player'} roomSlug="demo"
          round={{ id:'r1', type:'color', state, title:'Colors', order:0 }}
          question={{ id:'q1', order:0, prompt:null, displayPrompt:'Question 1', initialColor:'#83C547', media:{storagePath:'image'}, ${format === "svg" ? "regionIds:['left','right']" : "mask:{storagePath:'mask'}"} }}
          teamId="red" isHost={host} teams={[{id:'red',name:'Red team'},{id:'blue',name:'Blue team'}]} withAnswer={reveal} />);
      };
      window.renderColor(false, 'active');`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "local-color-transport", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "color-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "color-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/');
          export const onSnapshot = (path, optionsOrCallback, callback) => window.colorTransport.subscribe(path, typeof optionsOrCallback === 'function' ? optionsOrCallback : callback);
          export const getDocFromServer = async path => window.colorTransport.snapshot(path);` };
        if (args.path === "firebase/storage") return { contents: `
          export const getStorage = () => ({});
          export const ref = (_, path) => path;
          export const getDownloadURL = async path => { window.colorAssetReads.push(path); return window.colorAssets[path]; };` };
        if (args.path.includes("firebase-auth-provider")) return { contents: `const getToken = async () => 'test'; export const useFirebaseAuth = () => ({getToken});` };
        return { contents: `export const getClientFirestore = () => ({}); export const getFirebaseClientApp = () => ({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

for (const format of ["raster", "svg"] as const) for (const width of [1440, 390]) test(`live ${format} player, host and reveal at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__color-fixture", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body></body></html>` }));
  await page.goto("/__color-fixture");
  const image = await sharp({ create: { width: 160, height: 64, channels: 4, background: "#4285F4" } }).png().toBuffer();
  const maskBytes = Buffer.alloc(160 * 64 * 4, 255);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) maskBytes.fill(0, (y * 160 + x) * 4, (y * 160 + x) * 4 + 3);
  const mask = await sharp(maskBytes, { raw: { width: 160, height: 64, channels: 4 } }).png().toBuffer();
  await page.evaluate(({ image, mask }) => {
    const root = document.createElement("div"); root.id = "color-test"; root.className = "flex h-[420px] flex-col bg-zinc-950";
    document.body.replaceChildren(root);
    const docs: Record<string, { answer: string; locked?: boolean; perceptionScore?: number; awardedPoints?: number }> = { "rooms/demo/rounds/r1/answers/q1": { answer: "#4285F4" } };
    const w = window as unknown as Record<string, unknown>;
    const reads: string[] = [];
    w.colorAssets = { image, mask }; w.colorReads = reads; w.colorAssetReads = []; w.colorWrites = [];
    const snapshot = (path: string) => ({ data: () => docs[path], metadata: { fromCache: false } });
    const listeners = new Map<string, Set<(value: ReturnType<typeof snapshot>) => void>>();
    w.colorTransport = { snapshot, subscribe: (path: string, callback: (value: ReturnType<typeof snapshot>) => void) => {
      reads.push(path);
      if (!listeners.has(path)) listeners.set(path, new Set());
      listeners.get(path)!.add(callback); queueMicrotask(() => callback(snapshot(path)));
      return () => listeners.get(path)!.delete(callback);
    } };
    const setTeamColor = (team: string, color: string) => {
      const path = `rooms/demo/teams/${team}/rounds/r1/answers/q1`;
      docs[path] = { ...docs[path], answer: color }; listeners.get(path)?.forEach((callback) => callback(snapshot(path)));
    };
    const setTeamLocked = (team: string, locked: boolean) => {
      const path = `rooms/demo/teams/${team}/rounds/r1/answers/q1`;
      docs[path] = { ...docs[path], answer: docs[path]?.answer ?? "#83C547", locked };
      listeners.get(path)?.forEach((callback) => callback(snapshot(path)));
    };
    w.setTeamColor = setTeamColor;
    w.setTeamLocked = setTeamLocked;
    w.getTeamColor = (team: string) => docs[`rooms/demo/teams/${team}/rounds/r1/answers/q1`]?.answer ?? "#83C547";
    w.freezeColorAnswers = () => {
      for (const team of ["red", "blue"]) {
        const path = `rooms/demo/rounds/r1/teamAnswers/${team}/answers/q1`;
        if (!docs[path]) docs[path] = { answer: docs[`rooms/demo/teams/${team}/rounds/r1/answers/q1`]?.answer ?? "#83C547" };
      }
    };
    w.gradeTeamColor = (team: string, perceptionScore: number, awardedPoints: number) => {
      const path = `rooms/demo/rounds/r1/teamAnswers/${team}/answers/q1`;
      docs[path] = { ...docs[path], perceptionScore, awardedPoints };
      listeners.get(path)?.forEach((callback) => callback(snapshot(path)));
    };
    const assetFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (typeof url === "string" && url.startsWith("data:")) return assetFetch(url);
      const body = JSON.parse(options!.body as string);
      (w.colorWrites as Harness["colorWrites"]).push(body);
      if (w.rejectNextColorWrite) {
        w.rejectNextColorWrite = false;
        return new Response(JSON.stringify({ message: "Unable to save answer lock." }), { status: 503 });
      }
      if ("answer" in body) {
        if (docs[`rooms/demo/teams/${body.teamId}/rounds/r1/answers/q1`]?.locked) return new Response(JSON.stringify({ message: "Unlock the answer before editing." }), { status: 409 });
        setTeamColor(body.teamId, body.answer);
      } else setTeamLocked(body.teamId, body.locked);
      return new Response("{}", { status: 200 });
    };
  }, { image: format === "svg" ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64"><rect width="160" height="64" style="fill:#4285F4"/><rect id="left" x="16" width="64" height="64" fill="red" style="fill:#4285F4!important"/><rect id="right" x="80" width="80" height="64" style="fill:#4285F4"/></svg>')}` : `data:image/png;base64,${image.toString("base64")}`, mask: `data:image/png;base64,${mask.toString("base64")}` });
  await page.addScriptTag({ content: await bundle(format) });
  const assetReads = format === "svg" ? ["image"] : ["image", "mask"];
  const pixel = (label: string, x = 120) => page.getByRole("img", { name: label, exact: true }).evaluate(async (element, x) => {
    if (element instanceof HTMLCanvasElement) return [...element.getContext("2d")!.getImageData(x, 32, 1, 1).data];
    const image = new Image();
    const copy = element.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("width", "160"); copy.setAttribute("height", "64");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 160, 64);
      return [...context.getImageData(x, 32, 1, 1).data];
    } finally { URL.revokeObjectURL(url); }
  }, x);
  await expect.poll(() => pixel("Color question")).toEqual([131, 197, 71, 255]);
  await expect(page.getByText("Team", { exact: true })).toBeVisible();
  if (format === "svg") await expect.poll(() => pixel("Color question", 40)).toEqual([131, 197, 71, 255]);
  const hue = page.getByRole("slider", { name: "Hue", exact: true });
  const writeCount = () => page.evaluate(() => (window as unknown as Harness).colorWrites.length);
  await expect(page.getByRole("button", { name: "Lock answer", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as Harness).rejectNextColorWrite = true; });
  await page.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Unable to save answer lock.");
  await expect(page.getByRole("button", { name: "Lock answer", exact: true })).toBeEnabled();
  await expect(hue).toBeEnabled();
  await page.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unlock answer", exact: true })).toBeEnabled();
  await expect(hue).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Harness).getTeamColor("red"))).toBe("#83C547");
  await page.evaluate(() => (window as unknown as Harness).setTeamLocked("red", false));
  await expect(hue).toBeEnabled();
  await page.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock answer", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Unlock answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lock answer", exact: true })).toBeEnabled();
  await expect(hue).toBeEnabled();
  const initialWrites = await writeCount();
  await expect(hue).toHaveAttribute("aria-orientation", "horizontal");
  const tracks = page.locator(".color-picker-track");
  await expect(tracks).toHaveCount(3);
  const boxes = await tracks.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(boxes.every((box) => box.width > box.height * 3 && box.x === boxes[0].x)).toBe(true);
  expect(boxes.every((box) => box.height === 28)).toBe(true);
  expect((await page.locator(".color-picker-tracks").boundingBox())!.height).toBe(108);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
  expect(boxes[2].y).toBeGreaterThan(boxes[1].y + boxes[1].height);
  const imageBox = (await page.getByRole("img", { name: "Color question", exact: true }).boundingBox())!;
  const activeIndicator = (await page.getByText("Team", { exact: true }).boundingBox())!;
  const activeWidth = Math.min(imageBox.width, imageBox.height * 160 / 64);
  const activeHeight = activeWidth * 64 / 160;
  expect(Math.abs(activeIndicator.x - imageBox.x - (imageBox.width - activeWidth) / 2 - 8)).toBeLessThan(1);
  expect(Math.abs(activeIndicator.y - imageBox.y - (imageBox.height - activeHeight) / 2 - 8)).toBeLessThan(1);
  expect(boxes[0].y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
  expect(boxes[2].y + boxes[2].height).toBeLessThanOrEqual(420);
  for (let index = 0; index < 3; index++) {
    const handle = (await page.locator(".color-picker-handle").nth(index).boundingBox())!;
    expect(handle.y + handle.height / 2).toBeCloseTo(boxes[index].y + boxes[index].height / 2);
    expect(handle.y - boxes[index].y).toBeGreaterThanOrEqual(4);
  }
  const initialSaturationTrack = await tracks.nth(1).evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(await pixel("Color question", 8)).toEqual([66, 133, 244, 255]);
  expect(await page.evaluate(() => (window as unknown as Harness).colorReads.some((path) => path.includes("rounds/r1/answers/q1") && !path.includes("teams")))).toBe(false);
  await page.getByRole("slider", { name: "Hue", exact: true }).press("Home");
  const leftHandle = (await page.locator(".color-picker-handle").first().boundingBox())!;
  expect(leftHandle.x - boxes[0].x).toBeGreaterThanOrEqual(4);
  await expect.poll(() => pixel("Color question")).not.toEqual([131, 197, 71, 255]);
  await expect.poll(() => tracks.nth(1).evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(initialSaturationTrack);
  await expect.poll(writeCount).toBe(initialWrites + 1);
  await page.clock.install();
  const colorBeforeLock = await page.evaluate(() => (window as unknown as Harness).getTeamColor("red"));
  await page.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock answer", exact: true })).toBeEnabled();
  await page.clock.runFor(600);
  await expect(hue).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Harness).getTeamColor("red"))).toBe(colorBeforeLock);
  await page.getByRole("button", { name: "Unlock answer", exact: true }).click();
  await expect(hue).toBeEnabled();
  const beforeDrag = await writeCount();
  const beforeSavedColor = await page.evaluate(() => (window as unknown as Harness).getTeamColor("red"));
  const hueBox = (await hue.boundingBox())!;
  await page.mouse.move(hueBox.x + 12, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.65, hueBox.y + hueBox.height / 2, { steps: 5 });
  const previewDuringDrag = await pixel("Color question");
  expect(previewDuringDrag).not.toEqual([197, 71, 71, 255]);
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeDrag);
  expect(await page.evaluate(() => (window as unknown as Harness).getTeamColor("red"))).toBe(beforeSavedColor);
  await hue.blur();
  expect(await writeCount()).toBe(beforeDrag);
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#00FF00"));
  await expect.poll(() => pixel("Color question")).toEqual(previewDuringDrag);
  await page.mouse.up();
  await expect.poll(writeCount).toBe(beforeDrag + 1);
  await hue.blur();
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeDrag + 1);
  await expect.poll(async () => Number(await hue.inputValue())).toBeGreaterThan(200);
  await expect.poll(async () => Number(await hue.inputValue())).toBeLessThan(260);
  const savedHue = Number(await hue.inputValue());
  const thumbX = hueBox.x + 12 + (hueBox.width - 24) * savedHue / 360;
  const beforeNoop = await writeCount();
  await page.mouse.move(thumbX, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.25, hueBox.y + hueBox.height / 2, { steps: 3 });
  await page.mouse.move(thumbX, hueBox.y + hueBox.height / 2, { steps: 3 });
  await page.mouse.up();
  await hue.blur();
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeNoop);
  const beforeCancel = await writeCount();
  const savedPixel = await pixel("Color question");
  await page.mouse.move(thumbX, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.4, hueBox.y + hueBox.height / 2, { steps: 3 });
  expect(await pixel("Color question")).not.toEqual(savedPixel);
  await hue.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeCancel);
  await expect.poll(() => pixel("Color question")).toEqual(savedPixel);
  const beforeOutsideRelease = await writeCount();
  await page.mouse.move(thumbX, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width + 40, hueBox.y + hueBox.height + 20, { steps: 5 });
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeOutsideRelease);
  await page.mouse.up();
  await expect.poll(writeCount).toBe(beforeOutsideRelease + 1);
  const beforeKeyboard = await writeCount();
  await hue.focus();
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down("ArrowLeft");
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeKeyboard);
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  expect(await writeCount()).toBe(beforeKeyboard);
  await page.keyboard.up("ArrowLeft");
  await expect.poll(writeCount).toBe(beforeKeyboard + 1);
  await hue.blur();
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeKeyboard + 1);
  if (width === 390) {
    const beforeTouch = await writeCount();
    await page.touchscreen.tap(hueBox.x + hueBox.width / 2, hueBox.y + hueBox.height / 2);
    await expect.poll(writeCount).toBe(beforeTouch + 1);
    await expect.poll(async () => Number(await hue.inputValue())).toBeGreaterThan(160);
    await expect.poll(async () => Number(await hue.inputValue())).toBeLessThan(200);
  }
  await page.getByRole("slider", { name: "Saturation", exact: true }).press("Home");
  await expect.poll(() => pixel("Color question")).toEqual([197, 197, 197, 255]);
  await page.getByRole("slider", { name: "Value", exact: true }).press("Home");
  await expect.poll(() => pixel("Color question")).toEqual([0, 0, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#FF0000"));
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  for (const index of [1, 2]) {
    const handle = (await page.locator(".color-picker-handle").nth(index).boundingBox())!;
    expect(boxes[index].x + boxes[index].width - handle.x - handle.width).toBeGreaterThanOrEqual(4);
  }
  await page.getByRole("slider", { name: "Value", exact: true }).blur();
  const beforeRemoteLock = await writeCount();
  await page.mouse.move(hueBox.x + 16, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width / 2, hueBox.y + hueBox.height / 2, { steps: 3 });
  expect(await pixel("Color question")).not.toEqual([255, 0, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).setTeamLocked("red", true));
  await expect(hue).toBeDisabled();
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await page.clock.runFor(600);
  expect(await writeCount()).toBe(beforeRemoteLock);
  await page.getByRole("button", { name: "Unlock answer", exact: true }).click();
  await expect(hue).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`), fullPage: true });
  await page.evaluate(() => { (window as unknown as Harness).setTeamColor("blue", "#00FF00"); (window as unknown as Harness).renderColor(true, "active"); });
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await expect(page.getByText("Team", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^(Unl|L)ock answer$/ })).toHaveCount(0);
  if (format === "svg") {
    const bounds = (await page.getByRole("img", { name: "Red team's answer" }).boundingBox())!;
    expect(bounds.height).toBeGreaterThan(0);
  }
  const labelColor = await page.getByText("Red team", { exact: true }).evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(labelColor.slice(0, 3).every((channel) => channel >= 230)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Harness).colorAssetReads)).toEqual(assetReads);
  async function expectImagesFitPanel() {
    const panel = page.locator("#color-test");
    const bounds = (await panel.boundingBox())!;
    expect(await panel.evaluate((element) => [...element.querySelectorAll("div")].every((child) => child.scrollHeight <= child.clientHeight + 1))).toBe(true);
    for (const image of await panel.getByRole("img").all()) {
      const imageBounds = (await image.boundingBox())!;
      expect(imageBounds.height).toBeGreaterThan(0);
      expect(imageBounds.y).toBeGreaterThanOrEqual(bounds.y);
      expect(imageBounds.y + imageBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }
  await page.locator("#color-test").evaluate((element) => { element.style.height = "240px"; });
  await expectImagesFitPanel();
  await page.screenshot({ path: testInfo.outputPath(`host-${width}.png`), fullPage: true });
  await page.evaluate(() => (window as unknown as Harness).renderColor(true, "closed"));
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(1);
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await expectImagesFitPanel();
  await expect(page.getByText("Original", { exact: true })).toBeVisible();
  await expect(page.getByText("Team", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Unl|L)ock answer$/ })).toHaveCount(0);
  await expect(page.getByText("Team", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Question score")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#00FF00"));
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  await page.mouse.move(0, 0);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await expect(page.getByLabel("Question score")).toContainText("Scoring...");
  await page.evaluate(() => (window as unknown as Harness).gradeTeamColor("red", 8.74, 0.5));
  await expect(page.getByLabel("Question score")).toContainText("8.74 / 10");
  await expect(page.getByLabel("Question score")).toContainText("Points 0.5");
  await expectImagesFitPanel();
  const comparison = page.getByRole("button", { name: "Compare submitted image" });
  const transition = page.locator(".color-answer-transition");
  await transition.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 500;
    const fold = element.closest("button")!.querySelector(".color-answer-fold")!.getAnimations()[0];
    if (fold) { fold.pause(); fold.currentTime = 500; }
  });
  await expect(transition).toHaveCSS("clip-path", "inset(0px 50% 0px 0px)");
  await expect(page.locator(".color-answer-fold")).toHaveCSS("opacity", "1");
  async function halves() {
    const screenshot = await comparison.screenshot();
    const bounds = (await comparison.boundingBox())!;
    const imageWidth = Math.min(bounds.width, bounds.height * 160 / 64);
    const pixels = await Promise.all([-1, 1].map(async (side) => [...await sharp(screenshot).extract({ left: Math.floor(bounds.width / 2 + side * imageWidth / 4), top: Math.floor(bounds.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer()]));
    return pixels;
  }
  expect(await halves()).toEqual([[66, 133, 244], [255, 0, 0]]);
  await page.screenshot({ path: testInfo.outputPath(`wipe-${width}.png`), fullPage: true });
  await transition.evaluate((element) => element.getAnimations()[0].finish());
  await page.mouse.move(0, 0);
  await comparison.hover();
  await expect.poll(() => pixel("Submitted answer")).toEqual([255, 0, 0, 255]);
  await expect(page.locator(".color-answer-correct-layer")).toHaveCSS("clip-path", "inset(0px 0px 0px 50%)");
  expect(await halves()).toEqual([[255, 0, 0], [66, 133, 244]]);
  await expect(comparison.getByText("Team", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Original", { exact: true })).toBeVisible();
  const imageBounds = (await comparison.boundingBox())!;
  const teamLabel = (await comparison.getByText("Team", { exact: true }).boundingBox())!;
  const originalLabel = (await comparison.getByText("Original", { exact: true }).boundingBox())!;
  const artworkWidth = Math.min(imageBounds.width, imageBounds.height * 160 / 64);
  const artworkHeight = artworkWidth * 64 / 160;
  const horizontalInset = (imageBounds.width - artworkWidth) / 2;
  const verticalInset = (imageBounds.height - artworkHeight) / 2;
  expect(Math.abs(teamLabel.x - imageBounds.x - horizontalInset - 8)).toBeLessThan(1);
  expect(Math.abs(imageBounds.x + imageBounds.width - originalLabel.x - originalLabel.width - horizontalInset - 8)).toBeLessThan(1);
  expect(Math.abs(teamLabel.y - imageBounds.y - verticalInset - 8)).toBeLessThan(1);
  expect(Math.abs(originalLabel.y - imageBounds.y - verticalInset - 8)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath(`split-${width}.png`), fullPage: true });
  await page.mouse.move(0, 0);
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await expect(page.locator(".color-answer-correct-layer")).toHaveCSS("clip-path", "inset(0px)");
  await expect(comparison.getByText("Team", { exact: true })).toBeHidden();
  await expect(comparison.getByText("Original", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await comparison.focus();
  await expect(comparison).toBeFocused();
  await expect.poll(() => pixel("Submitted answer")).toEqual([255, 0, 0, 255]);
  await comparison.blur();
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await comparison.dispatchEvent("pointerdown", { pointerType: "touch" });
  await expect.poll(() => pixel("Submitted answer")).toEqual([255, 0, 0, 255]);
  await comparison.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await page.screenshot({ path: testInfo.outputPath(`reveal-${width}.png`), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", false));
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect(transition).toHaveCSS("animation-name", "none");
  await page.evaluate(() => (window as unknown as Harness).gradeTeamColor("red", 0, 0));
  await expect(page.getByLabel("Question score")).toContainText("0.00 / 10");
  await expect(page.getByLabel("Question score")).toContainText("Points 0");
  expect(await page.evaluate(() => (window as unknown as Harness).colorAssetReads)).toEqual(assetReads);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
