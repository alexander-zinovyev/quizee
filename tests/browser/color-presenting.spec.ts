import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";

test.use({ hasTouch: true });

type Harness = Window & {
  renderColor: (host: boolean, state: "active" | "closed", reveal?: boolean) => void;
  setTeamColor: (team: string, color: string) => void;
  colorReads: string[];
  colorAssetReads: string[];
  gradeTeamColor: (team: string, perceptionScore: number, awardedPoints: number) => void;
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
          export const onSnapshot = (path, callback) => window.colorTransport.subscribe(path, callback);
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
  for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) maskBytes.fill(0, (y * 160 + x) * 4, (y * 160 + x) * 4 + 3);
  const mask = await sharp(maskBytes, { raw: { width: 160, height: 64, channels: 4 } }).png().toBuffer();
  await page.evaluate(({ image, mask }) => {
    const root = document.createElement("div"); root.id = "color-test"; root.className = "flex h-[420px] flex-col bg-zinc-950";
    document.body.replaceChildren(root);
    const docs: Record<string, { answer: string; perceptionScore?: number; awardedPoints?: number }> = { "rooms/demo/rounds/r1/answers/q1": { answer: "#4285F4" } };
    const listeners = new Map<string, Set<(value: { data: () => { answer: string } | undefined }) => void>>();
    const w = window as unknown as Record<string, unknown>;
    const reads: string[] = [];
    w.colorAssets = { image, mask }; w.colorReads = reads; w.colorAssetReads = [];
    const snapshot = (path: string): { data: () => { answer: string } | undefined } => ({ data: () => docs[path] });
    w.colorTransport = { snapshot, subscribe: (path: string, callback: (value: ReturnType<typeof snapshot>) => void) => {
      reads.push(path);
      if (!listeners.has(path)) listeners.set(path, new Set());
      listeners.get(path)!.add(callback); queueMicrotask(() => callback(snapshot(path)));
      return () => listeners.get(path)!.delete(callback);
    } };
    const setTeamColor = (team: string, color: string) => {
      const path = `rooms/demo/teams/${team}/rounds/r1/answers/q1`;
      docs[path] = { answer: color }; listeners.get(path)?.forEach((callback) => callback(snapshot(path)));
    };
    w.setTeamColor = setTeamColor;
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
      const body = JSON.parse(options!.body as string); setTeamColor(body.teamId, body.answer);
      return new Response("{}", { status: 200 });
    };
  }, { image: format === "svg" ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64"><rect width="160" height="64" fill="#4285F4"/><rect id="left" x="80" width="40" height="64" fill="#4285F4"/><rect id="right" x="120" width="40" height="64" fill="#4285F4"/></svg>')}` : `data:image/png;base64,${image.toString("base64")}`, mask: `data:image/png;base64,${mask.toString("base64")}` });
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
  if (format === "svg") await expect.poll(() => pixel("Color question", 100)).toEqual([131, 197, 71, 255]);
  const hue = page.getByRole("slider", { name: "Hue", exact: true });
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
  expect(boxes[0].y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
  expect(boxes[2].y + boxes[2].height).toBeLessThanOrEqual(420);
  for (let index = 0; index < 3; index++) {
    const handle = (await page.locator(".color-picker-handle").nth(index).boundingBox())!;
    expect(handle.y + handle.height / 2).toBeCloseTo(boxes[index].y + boxes[index].height / 2);
    expect(handle.y - boxes[index].y).toBeGreaterThanOrEqual(4);
  }
  const initialSaturationTrack = await tracks.nth(1).evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(await pixel("Color question", 16)).toEqual([66, 133, 244, 255]);
  expect(await page.evaluate(() => (window as unknown as Harness).colorReads.some((path) => path.includes("rounds/r1/answers/q1") && !path.includes("teams")))).toBe(false);
  await page.getByRole("slider", { name: "Hue", exact: true }).press("Home");
  const leftHandle = (await page.locator(".color-picker-handle").first().boundingBox())!;
  expect(leftHandle.x - boxes[0].x).toBeGreaterThanOrEqual(4);
  await expect.poll(() => pixel("Color question")).not.toEqual([131, 197, 71, 255]);
  await expect.poll(() => tracks.nth(1).evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(initialSaturationTrack);
  const hueBox = (await hue.boundingBox())!;
  await page.mouse.move(hueBox.x + 12, hueBox.y + hueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hueBox.x + hueBox.width * 0.65, hueBox.y + hueBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await hue.inputValue())).toBeGreaterThan(200);
  await expect.poll(async () => Number(await hue.inputValue())).toBeLessThan(260);
  if (width === 390) {
    await page.touchscreen.tap(hueBox.x + hueBox.width / 2, hueBox.y + hueBox.height / 2);
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
  await page.screenshot({ path: testInfo.outputPath(`player-${width}.png`), fullPage: true });
  await page.evaluate(() => { (window as unknown as Harness).setTeamColor("blue", "#00FF00"); (window as unknown as Harness).renderColor(true, "active"); });
  await expect.poll(() => pixel("Red team's answer")).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel("Blue team's answer")).toEqual([0, 255, 0, 255]);
  if (format === "svg") {
    const bounds = (await page.getByRole("img", { name: "Red team's answer" }).boundingBox())!;
    expect(Math.abs(bounds.height - bounds.width * 64 / 160)).toBeLessThan(1);
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
  await page.screenshot({ path: testInfo.outputPath(`host-${width}.png`), fullPage: true });
  await page.evaluate(() => (window as unknown as Harness).renderColor(true, "closed"));
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(1);
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed"));
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByLabel("Question score")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Correct answer" })).toHaveCount(0);
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).setTeamColor("red", "#00FF00"));
  await expect.poll(() => pixel("Color question")).toEqual([255, 0, 0, 255]);
  await page.evaluate(() => (window as unknown as Harness).renderColor(false, "closed", true));
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await expect(page.getByLabel("Question score")).toContainText("Scoring...");
  await page.evaluate(() => (window as unknown as Harness).gradeTeamColor("red", 8.74, 0.5));
  await expect(page.getByLabel("Question score")).toContainText("8.74 / 10");
  await expect(page.getByLabel("Question score")).toContainText("Points 0.5");
  const comparison = page.getByRole("button", { name: "Compare submitted image" });
  const transition = page.locator(".color-answer-transition");
  await transition.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 350;
  });
  const opacity = await transition.evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
  const screenshot = await comparison.screenshot();
  const bounds = (await comparison.boundingBox())!;
  const composite = await sharp(screenshot).extract({ left: Math.floor(bounds.width / 2 + Math.min(bounds.width, bounds.height) / 4), top: Math.floor(bounds.height / 2), width: 1, height: 1 }).raw().toBuffer();
  expect(composite[0]).toBeGreaterThan(66);
  expect(composite[0]).toBeLessThan(255);
  await transition.evaluate((element) => element.getAnimations()[0].finish());
  await page.mouse.move(0, 0);
  await comparison.hover();
  await expect.poll(() => pixel("Submitted answer")).toEqual([255, 0, 0, 255]);
  await page.mouse.move(0, 0);
  await expect.poll(() => pixel("Correct answer")).toEqual([66, 133, 244, 255]);
  await comparison.focus();
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
