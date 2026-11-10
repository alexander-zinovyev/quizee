import { test, expect, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";

test.use({ hasTouch: true });

type Harness = Window & {
  renderColor: (host: boolean, state: "active" | "closed", reveal?: boolean, questionId?: string, teamId?: string) => void;
  setTeamColor: (team: string, color: string, questionId?: string) => void;
  setTeamLocked: (team: string, locked: boolean) => void;
  colorReads: string[];
  colorAssetReads: string[];
  gradeTeamColor: (team: string, perceptionScore: number, awardedPoints: number) => void;
  colorWrites: Array<{ teamId: string; answer?: string; locked?: boolean }>;
  getTeamColor: (team: string) => string;
  rejectNextColorWrite: boolean;
  deferColorReads: boolean;
  releaseColorReads: () => void;
  rejectColorRead?: string;
  setFrozenColor: (team: string, color: string | null, questionId: string) => void;
  colorTeams?: Array<{ id: string; name: string }>;
  renderSecondColor: () => void;
};

async function bundle(format: "raster" | "svg") {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ColorPresenting } from './lib/components/color-presenting';
      const root = createRoot(document.getElementById('color-test'));
      const colorView = (host, state, reveal = false, questionId = 'q1', teamId = 'red') => {
        if (state === 'closed') window.freezeColorAnswers();
        return <ColorPresenting key={[host ? 'host' : teamId, questionId].join(':')} roomSlug="demo"
          round={{ id:'r1', type:'color', state, title:'Colors', order:0 }}
          question={{ id:questionId, order:0, prompt:null, displayPrompt:questionId, initialColor:questionId === 'q1' ? '#83C547' : '#112233', media:{storagePath:'image'}, ${format === "svg" ? "regionIds:['left','right']" : "mask:{storagePath:'mask'}"} }}
          teamId={teamId} isHost={host} teams={window.colorTeams ?? [{id:'red',name:'Red team'},{id:'blue',name:'Blue team'}]} withAnswer={reveal} />;
      };
      window.renderColor = (...args) => root.render(colorView(...args));
      window.renderSecondColor = () => {
        const element = document.createElement('div');
        element.id = 'second-player';
        element.className = 'flex h-[420px] flex-col bg-zinc-950';
        document.body.append(element);
        createRoot(element).render(colorView(false, 'closed'));
      };
      window.renderColor(false, 'active');`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "local-color-transport", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "color-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "color-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/');
          export const onSnapshot = (path, optionsOrCallback, callback) => window.colorTransport.subscribe(path, typeof optionsOrCallback === 'function' ? optionsOrCallback : callback);
          export const getDocFromServer = async path => window.colorTransport.read(path);` };
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

async function mountColor(page: Page, format: "raster" | "svg") {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__color-fixture", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body></body></html>` }));
  await page.goto("/__color-fixture");
  const image = await sharp({ create: { width: 160, height: 64, channels: 4, background: "#4285F4" } }).png().toBuffer();
  const maskBytes = Buffer.alloc(160 * 64 * 4, 255);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 160; x++) if (x < 16 || x >= 64 && x < 88) maskBytes.fill(0, (y * 160 + x) * 4, (y * 160 + x) * 4 + 3);
  // A partially weighted strip verifies that the cue follows grayscale and mask alpha.
  for (let y = 0; y < 16; y++) for (let x = 0; x < 160; x++) if (x >= 32 && x < 48 || x >= 112 && x < 128) {
    const pixel = (y * 160 + x) * 4;
    maskBytes.fill(128, pixel, pixel + 4);
  }
  const mask = await sharp(maskBytes, { raw: { width: 160, height: 64, channels: 4 } }).png().toBuffer();
  // Keep the SVG viewBox padded to cover cue dimensions for valid whitespace.
  await page.evaluate(({ image, mask }) => {
    const root = document.createElement("div"); root.id = "color-test"; root.className = "flex h-[420px] flex-col bg-zinc-950";
    document.body.replaceChildren(root);
    const docs: Record<string, { answer: string; locked?: boolean; perceptionScore?: number; awardedPoints?: number }> = {
      "rooms/demo/rounds/r1/answers/q1": { answer: "#4285F4" },
      "rooms/demo/rounds/r1/answers/q2": { answer: "#FF00FF" },
      "rooms/demo/teams/red/rounds/r1/answers/q2": { answer: "#FFFF00" },
    };
    const w = window as unknown as Record<string, unknown>;
    const reads: string[] = [];
    w.colorAssets = { image, mask }; w.colorReads = reads; w.colorAssetReads = []; w.colorWrites = [];
    const snapshot = (path: string) => ({ data: () => docs[path], exists: () => !!docs[path], metadata: { fromCache: false } });
    const deferredReads: Array<() => void> = [];
    w.releaseColorReads = () => { w.deferColorReads = false; deferredReads.splice(0).forEach((release) => release()); };
    const listeners = new Map<string, Set<(value: ReturnType<typeof snapshot>) => void>>();
    w.colorTransport = { read: (path: string) => {
      reads.push(path);
      if (w.rejectColorRead === path) throw new Error("Unable to load team submissions.");
      if (w.deferColorReads && path.includes("/teamAnswers/")) return new Promise((resolve) => deferredReads.push(() => resolve(snapshot(path))));
      return snapshot(path);
    }, subscribe: (path: string, callback: (value: ReturnType<typeof snapshot>) => void) => {
      reads.push(path);
      if (!listeners.has(path)) listeners.set(path, new Set());
      listeners.get(path)!.add(callback); queueMicrotask(() => callback(snapshot(path)));
      return () => listeners.get(path)!.delete(callback);
    } };
    const setTeamColor = (team: string, color: string, questionId = "q1") => {
      const path = `rooms/demo/teams/${team}/rounds/r1/answers/${questionId}`;
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
    let frozen = false;
    w.freezeColorAnswers = () => {
      if (frozen) return;
      frozen = true;
      for (const team of ["red", "blue"]) for (const questionId of ["q1", "q2"]) {
        const path = `rooms/demo/rounds/r1/teamAnswers/${team}/answers/${questionId}`;
        if (!docs[path]) docs[path] = { answer: docs[`rooms/demo/teams/${team}/rounds/r1/answers/${questionId}`]?.answer ?? (questionId === "q1" ? "#83C547" : "#112233") };
      }
    };
    w.setFrozenColor = (team: string, color: string | null, questionId: string) => {
      const path = `rooms/demo/rounds/r1/teamAnswers/${team}/answers/${questionId}`;
      if (color === null) delete docs[path];
      else docs[path] = { answer: color };
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
  }, { image: format === "svg" ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox=" 0 0 160 64 "><rect width="160" height="64" style="fill:#4285F4"/><rect id="left" x="16" width="48" height="64" fill="red" style="fill:#4285F4!important"/><rect id="right" x="88" width="72" height="64" style="fill:#4285F4"/></svg>')}` : `data:image/png;base64,${image.toString("base64")}`, mask: `data:image/png;base64,${mask.toString("base64")}` });
  await page.addScriptTag({ content: await bundle(format) });
}

for (const format of ["raster", "svg"] as const) for (const width of [1440, 390]) test(`live ${format} player, host and reveal at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await mountColor(page, format);
  const assetReads = format === "svg" ? ["image"] : ["image", "mask"];
  const pixel = (label: string, x = 120, container?: Locator) => (container ?? page).getByRole("img", { name: label, exact: true }).evaluate(async (element, x) => {
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
  await expect(page.getByRole("region", { name: "Opponent submission", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Harness).colorReads.some((path) => path.includes("/teams/blue/") || path.includes("/teamAnswers/blue/")))).toBe(false);
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
      expect(imageBounds.x).toBeGreaterThanOrEqual(bounds.x);
      expect(imageBounds.x + imageBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
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
  const readsBeforePlayer = await page.evaluate(() => (window as unknown as Harness).colorReads.length);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  const ownSubmission = page.getByRole("region", { name: "Your submission", exact: true });
  const opponentSubmission = page.getByRole("region", { name: "Opponent submission", exact: true });
  await expect(ownSubmission).toBeVisible();
  await expect(opponentSubmission).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Unl|L)ock answer$/ })).toHaveCount(0);
  await expect(page.getByLabel("Question score")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await expect(ownSubmission.getByRole("heading")).toHaveText("Red team");
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Blue team");
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await expect(opponentSubmission.getByRole("button", { name: "Next opponent" })).toBeDisabled();
  await expect(opponentSubmission.getByRole("button", { name: "Previous opponent" })).toBeDisabled();
  const ownBounds = (await ownSubmission.boundingBox())!;
  const opponentBounds = (await opponentSubmission.boundingBox())!;
  expect(ownBounds.x + ownBounds.width).toBeLessThanOrEqual(opponentBounds.x);
  expect(ownBounds.y).toBe(opponentBounds.y);
  expect(ownBounds.height).toBe(opponentBounds.height);
  await expectImagesFitPanel();
  expect(await page.evaluate((start) => (window as unknown as Harness).colorReads.slice(start).sort(), readsBeforePlayer)).toEqual([
    "rooms/demo/rounds/r1/teamAnswers/blue/answers/q1",
    "rooms/demo/rounds/r1/teamAnswers/red/answers/q1",
  ]);
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.setTeamColor("red", "#00FF00");
    w.setTeamColor("blue", "#0000FF");
  });
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await page.screenshot({ path: testInfo.outputPath(`closed-submissions-${width}.png`), fullPage: true });

  await page.mouse.move(0, 0);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect.poll(() => pixel("Correct answer", 120, ownSubmission)).toEqual([66, 133, 244, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await expect(opponentSubmission.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await expect(page.getByLabel("Question score")).toContainText("Scoring...");
  await page.evaluate(() => (window as unknown as Harness).gradeTeamColor("red", 8.74, 0.5));
  await expect(page.getByLabel("Question score")).toContainText("8.74 / 10");
  await expect(page.getByLabel("Question score")).toContainText("Points 0.5");
  expect(await page.evaluate((start) => (window as unknown as Harness).colorReads.slice(start).filter((path) => path.includes("/teamAnswers/blue/")), readsBeforePlayer)).toEqual(["rooms/demo/rounds/r1/teamAnswers/blue/answers/q1"]);
  await expectImagesFitPanel();
  const comparison = ownSubmission.getByRole("button", { name: "Compare submitted image" });
  const opponentComparison = opponentSubmission.getByRole("button", { name: "Compare submitted image" });
  const transition = ownSubmission.locator(".color-answer-transition");
  await transition.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 500;
    const fold = element.closest("button")!.querySelector(".color-answer-fold")!.getAnimations()[0];
    if (fold) { fold.pause(); fold.currentTime = 500; }
  });
  await expect(transition).toHaveCSS("clip-path", "inset(0px 50% 0px 0px)");
  await expect(ownSubmission.locator(".color-answer-fold")).toHaveCSS("opacity", "1");
  async function halves(button: Locator) {
    const screenshot = await button.screenshot();
    const bounds = (await button.boundingBox())!;
    const imageWidth = Math.min(bounds.width, bounds.height * 160 / 64);
    return Promise.all([-1, 1].map(async (side) => [...await sharp(screenshot).extract({ left: Math.floor(bounds.width / 2 + side * imageWidth / 4), top: Math.floor(bounds.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer()]));
  }
  expect(await halves(comparison)).toEqual([[66, 133, 244], [255, 0, 0]]);
  await transition.evaluate((element) => element.getAnimations()[0].finish());
  async function expectComparisonEdgeAt(button: Locator, fraction: number) {
    await expect.poll(() => button.evaluate((element, fraction) => {
      const frame = element.getBoundingClientRect();
      const edge = element.querySelector(".color-answer-comparison-edge")!.getBoundingClientRect();
      return Math.abs(edge.x + edge.width / 2 - (frame.x + frame.width * fraction));
    }, fraction)).toBeLessThan(1);
  }
  await expectComparisonEdgeAt(comparison, 0);
  await expectComparisonEdgeAt(opponentComparison, 1);
  await comparison.hover();
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect(ownSubmission.locator(".color-answer-correct-layer")).toHaveCSS("clip-path", "inset(0px 0px 0px 50%)");
  expect(await halves(comparison)).toEqual([[255, 0, 0], [66, 133, 244]]);
  await expect(comparison.getByText("Team", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Original", { exact: true })).toBeVisible();
  await opponentComparison.hover();
  await expect(opponentSubmission.locator(".color-answer-correct-layer")).toHaveCSS("clip-path", "inset(0px 0px 0px 50%)");
  await expectComparisonEdgeAt(opponentComparison, 0.5);
  expect(await halves(opponentComparison)).toEqual([[0, 255, 0], [66, 133, 244]]);
  await expect(opponentComparison.getByText("Original", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Team", { exact: true })).toBeHidden();
  await page.mouse.move(0, 0);
  await expect(opponentComparison.getByText("Original", { exact: true })).toBeHidden();
  await expect(opponentComparison.getByText("Team", { exact: true })).toBeVisible();
  await expectComparisonEdgeAt(opponentComparison, 1);
  await expect.poll(() => pixel("Correct answer", 120, ownSubmission)).toEqual([66, 133, 244, 255]);
  await page.keyboard.press("Tab");
  for (const button of [comparison, opponentComparison]) {
    await button.focus();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.blur();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.dispatchEvent("pointerdown", { pointerType: "touch" });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.dispatchEvent("pointerup", { pointerType: "touch" });
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await expect(opponentSubmission.locator(".color-answer-correct-layer")).toHaveCSS("clip-path", "inset(0px 0px 0px 100%)");
  await page.screenshot({ path: testInfo.outputPath(`reveal-${width}.png`), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", false));
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect(transition).toHaveCSS("animation-name", "none");
  await page.evaluate(() => (window as unknown as Harness).gradeTeamColor("red", 0, 0));
  await expect(page.getByLabel("Question score")).toContainText("0.00 / 10");
  await expect(page.getByLabel("Question score")).toContainText("Points 0");
  expect(await page.evaluate(() => (window as unknown as Harness).colorAssetReads)).toEqual(assetReads);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", false, "q2"));
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 255, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([17, 34, 51, 255]);
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true, "q1", "blue"));
  await expect(ownSubmission.getByRole("heading")).toHaveText("Blue team");
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Red team");
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await page.mouse.move(0, 0);
  await comparison.hover();
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);

  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.deferColorReads = true;
    w.renderColor(false, "closed", false, "q2");
  });
  await expect(opponentSubmission.getByRole("status")).toHaveText("Loading submission...");
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  await expect(opponentSubmission.getByRole("status")).toHaveText("Loading submission...");
  await page.evaluate(() => (window as unknown as Harness).releaseColorReads());
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);

  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.rejectColorRead = "rooms/demo/rounds/r1/teamAnswers/blue/answers/q2";
    w.renderColor(false, "closed", false, "q2");
  });
  await expect(page.getByRole("alert")).toHaveText("Unable to load team submissions.");
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.rejectColorRead = undefined;
    w.renderColor(false, "closed");
  });
  await expect(opponentSubmission).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.setFrozenColor("blue", "red", "q2");
    w.renderColor(false, "closed", false, "q2");
  });
  await expect(page.getByRole("alert")).toHaveText("Invalid final color submission for team blue.");
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  await expect(opponentSubmission).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.setFrozenColor("blue", null, "q2");
    w.renderColor(false, "closed", false, "q2");
  });
  await expect(opponentSubmission.getByText("No final submission")).toBeVisible();

  const writesBeforeSelection = await writeCount();
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.colorTeams = [{ id: "red", name: "Red team" }, ...Array.from({ length: 9 }, (_, index) => ({ id: `extra-${index}`, name: `Team ${index + 1}` }))];
    w.colorTeams.slice(1).forEach((team) => w.setFrozenColor(team.id, "#00FFFF", "q1"));
    w.renderColor(false, "closed");
  });
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 1");
  await expect.poll(() => pixel("Team 1's answer")).toEqual([0, 255, 255, 255]);
  const readsBeforeSelection = await page.evaluate(() => (window as unknown as Harness).colorReads.length);
  const previous = opponentSubmission.getByRole("button", { name: "Previous opponent" });
  const next = opponentSubmission.getByRole("button", { name: "Next opponent" });
  await previous.click();
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 9");
  await next.click();
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 1");
  for (let index = 0; index < 8; index++) await next.click();
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 9");
  await expect.poll(() => pixel("Team 9's answer")).toEqual([0, 255, 255, 255]);
  expect(await page.evaluate(() => (window as unknown as Harness).colorReads.length)).toBe(readsBeforeSelection);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 9");
  await expect.poll(() => pixel("Team 9's answer")).toEqual([0, 255, 255, 255]);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  await expect(opponentSubmission.getByRole("heading")).toHaveText("Team 9");
  expect(await writeCount()).toBe(writesBeforeSelection);
  await expectImagesFitPanel();
  await page.screenshot({ path: testInfo.outputPath(`opponent-selector-${width}.png`), fullPage: true });
  await page.evaluate(() => (window as unknown as Harness).renderSecondColor());
  const secondOpponent = page.locator("#second-player").getByRole("region", { name: "Opponent submission", exact: true });
  await expect(secondOpponent.getByRole("heading")).toHaveText("Team 1");
  await expect(page.locator("#color-test").getByRole("region", { name: "Opponent submission", exact: true }).getByRole("heading")).toHaveText("Team 9");
  expect(await writeCount()).toBe(writesBeforeSelection);
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.colorTeams = [{ id: "red", name: "A very long player team name that wraps across several lines" }, { id: "extra-0", name: "A very long opponent team name that wraps across several lines" }];
    w.renderColor(false, "closed");
  });
  const primary = page.locator("#color-test");
  await expect(primary.getByRole("region", { name: "Opponent submission", exact: true }).getByRole("heading")).toHaveText("A very long opponent team name that wraps across several lines");
  await expect(primary.getByRole("button", { name: "Next opponent" })).toBeDisabled();
  await expectImagesFitPanel();
  await page.evaluate(() => {
    const w = window as unknown as Harness;
    w.colorTeams = [{ id: "red", name: "Red team" }];
    w.renderColor(false, "closed");
  });
  await expect(primary.getByText("No other teams", { exact: true })).toBeVisible();
  await expect(primary.getByRole("button", { name: "Next opponent" })).toHaveCount(0);
  await expectImagesFitPanel();
});

for (const format of ["raster", "svg"] as const) for (const reducedMotion of [false, true]) test(`editable-area cue for ${format}, reduced motion ${reducedMotion}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await mountColor(page, format);
  const cue = page.locator(".color-editable-cue");
  const band = cue.locator(".color-editable-cue-band");
  await expect(cue).toHaveCount(1);
  await expect(cue).toHaveAttribute("aria-hidden", "true");
  await expect(cue).toHaveCSS("pointer-events", "none");
  await expect(band).toHaveCSS("animation-play-state", "running");
  await expect(page.getByRole("slider", { name: "Hue", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as Harness).colorWrites)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as Harness).colorReads.some((path) => path === "rooms/demo/rounds/r1/answers/q1"))).toBe(false);

  // Pause at known progress to inspect real composited pixels without timing sleeps.
  await band.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 650;
    (window as unknown as { cueAnimation: Animation }).cueAnimation = animation;
  });
  const pixels = async (time: number, y = 32) => {
    await band.evaluate((element, time) => { element.getAnimations()[0].currentTime = time; }, time);
    const image = page.getByRole("img", { name: "Color question", exact: true });
    const bounds = (await image.boundingBox())!;
    const imageWidth = Math.min(bounds.width, bounds.height * 160 / 64);
    const screenshot = await image.locator("..").screenshot({ animations: "allow" });
    return Promise.all([8, 40, 76, 120].map(async (x) => [...await sharp(screenshot).extract({
      left: Math.floor((bounds.width - imageWidth) / 2 + x / 160 * imageWidth), top: Math.floor((bounds.height - imageWidth * 64 / 160) / 2 + y / 160 * imageWidth), width: 1, height: 1,
    }).removeAlpha().raw().toBuffer()]));
  };
  const base = await pixels(1300);
  expect(base).toEqual([[66, 133, 244], [131, 197, 71], [66, 133, 244], [131, 197, 71]]);
  if (reducedMotion) {
    const during = await pixels(650);
    expect(during[0]).toEqual(base[0]);
    expect(during[2]).toEqual(base[2]);
    expect(during[1][0]).toBeGreaterThan(base[1][0] + 50);
    expect(during[3][0]).toBeGreaterThan(base[3][0] + 50);
    await expect(band).toHaveCSS("transform", "none");
  } else {
    for (const [time, index] of [[487.5, 1], [812.5, 3]]) {
      const during = await pixels(time);
      expect(during[index][0]).toBeGreaterThan(base[index][0] + 50);
      expect(during[0]).toEqual(base[0]);
      expect(during[2]).toEqual(base[2]);
    }
  }
  if (format === "raster") {
    const partialBase = await pixels(1300, 8);
    const partialCue = await pixels(reducedMotion ? 650 : 487.5, 8);
    const fullCue = await pixels(reducedMotion ? 650 : 487.5);
    const partialDelta = partialCue[1][0] - partialBase[1][0];
    const fullDelta = fullCue[1][0] - base[1][0];
    expect(partialDelta).toBeGreaterThan(10);
    expect(partialDelta).toBeLessThan(fullDelta / 2);
  }
  await page.screenshot({ path: testInfo.outputPath("editable-cue.png") });
  const assertSameAnimation = () => expect.poll(() => band.evaluate((element) => element.getAnimations()[0] === (window as unknown as { cueAnimation: Animation }).cueAnimation)).toBe(true);
  await page.getByRole("slider", { name: "Hue", exact: true }).press("Home");
  await assertSameAnimation();
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#00FF00"));
  await assertSameAnimation();
  await page.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock answer", exact: true })).toBeEnabled();
  await assertSameAnimation();
  await band.evaluate((element) => element.getAnimations()[0].finish());
  await expect(band).toHaveCSS("opacity", "0");
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#FF0000"));
  await assertSameAnimation();
  await expect(band).toHaveCSS("opacity", "0");
  expect((await pixels(1300))[3]).toEqual([255, 0, 0]);

  for (const questionId of ["q2", "q1"]) {
    await page.evaluate((id) => (window as unknown as Harness).renderColor(false, "active", false, id), questionId);
    await expect.poll(() => band.evaluate((element) => element.getAnimations()[0] !== (window as unknown as { cueAnimation: Animation }).cueAnimation)).toBe(true);
    await band.evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 650;
      (window as unknown as { cueAnimation: Animation }).cueAnimation = animation;
    });
    await expect(band).not.toHaveCSS("opacity", "0");
  }
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect(cue).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Correct answer", exact: true })).toHaveCount(1);
  await page.evaluate(() => (window as unknown as Harness).renderColor(true, "active"));
  await expect(cue).toHaveCount(0);
});
