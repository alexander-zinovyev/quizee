import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

test.use({ hasTouch: true, colorScheme: "light" });

async function bundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import RoomRoundsPanel from './app/[room]/room-rounds-panel';
      import { SortingRound } from './lib/components/sorting-round';
      import QuizRound from './lib/components/quiz-round';
      const question = { id:'question-1', prompt:'Order events from earliest to latest', items:[
        {id:'a',stages:[{text:'A'}]},
        {id:'b',stages:[{text:'B',media:{storagePath:'images/b.svg',filename:'b.svg'}}]},
        {id:'c',stages:[{text:'C'}]}, {id:'d',stages:[{text:'D'}]}
      ]};
      const roots = ['red', 'teammate', 'blue', 'foreground'].map(id => createRoot(document.getElementById(id)));
      let generation = 0;
      window.renderSortingViews = (state = 'active', reveal = false, reconnect = false, foreground = 'Foreground one') => {
        if (reconnect) generation++;
        if (state === 'closed') window.sortingTransport.freeze();
        flushSync(() => {
        ['red','red','blue'].forEach((teamId,index) => roots[index].render(<RoomRoundsPanel
          key={generation} roomSlug="demo" teamId={teamId} rounds={[
            {id:'sorting',type:'sorting',title:'History sorting',roundNumber:1,state,questions:[question],presenting:reveal ? {round:'sorting',withAnswer:true}:null},
            {id:'foreground',type:'text',title:foreground,roundNumber:2,questions:[],emptyLabel:foreground}
          ]} />));
        roots[3].render(<SortingRound key={generation} roomSlug="demo" roundId="sorting" question={question} state={state} readOnly reveal={reveal} />);
        });
      };
      window.expandSortingItem = () => {
        question.items[1].stages.push({text:'Extra context',media:{storagePath:'images/extra.svg',filename:'extra.svg'}});
        window.renderSortingViews();
      };
      window.renderSortingDesign = () => {
        document.getElementById('red').className = 'flex h-[337px] w-[437px] flex-col';
        ['teammate','blue','foreground'].forEach(id => { document.getElementById(id).style.display = 'none'; });
        flushSync(() => roots[0].render(<QuizRound id="sorting" type="sorting" title="Сортуємо" roundNumber={1}
          state="active" roomSlug="demo" teamId="red" questions={[{id:'question-1',prompt:'Від найстарішого до найновішого',items:
            ['IKEA','Samsung','Sony','Disney','LEGO','Apple','Nintendo','McDonalds'].map((text,index) => ({id:String(index),stages:[{text}]}))}]} />));
      };
      window.renderSortingViews();`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "sorting-test-transport", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "sorting-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "sorting-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/');
          export const collection = doc;
          export const setDoc = () => { throw new Error('Direct answer writes are forbidden'); };
          export const onSnapshot = (path, callback) => window.sortingTransport.subscribe(path, callback);
          export const getDocFromServer = async path => window.sortingTransport.snapshot(path);` };
        if (args.path === "firebase/storage") return { contents: `
          export const getStorage = () => ({});
          export const ref = (_, path) => path;
          export const getDownloadURL = async path => { window.sortingAssetReads.push(path); return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>'); };` };
        if (args.path.includes("firebase-auth-provider")) return { contents: `const getToken = async () => 'test'; export const useFirebaseAuth = () => ({getToken,user:{uid:'player'}});` };
        return { contents: `export const getClientFirestore = () => ({}); export const getFirebaseClientApp = () => ({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Harness = {
  renderSortingDesign: () => void;
  expandSortingItem: () => void;
  renderSortingViews: (state?: "active" | "closed", reveal?: boolean, reconnect?: boolean, foreground?: string) => void;
  sortingReads: string[];
  sortingAssetReads: string[];
  sortingWrites: Array<{ teamId: string; answer: string }>;
  rejectNextSortingWrite: boolean;
  sortingTransport: { setTeam: (team: string, order: string[]) => void };
};
const order = (region: Locator) => region.getByRole("list", { name: "Sorting order", exact: true }).first().locator(":scope > li").evaluateAll((items) => items.map((item) => item.getAttribute("data-item-id")));

async function dragItem(page: Page, region: Locator, id: string, targetId: string, touch: boolean) {
  const handle = region.locator(`[data-item-id="${id}"]`).getByRole("button", { name: /^Reorder item/ });
  await region.getByRole("list", { name: "Sorting order", exact: true }).first().scrollIntoViewIfNeeded();
  await handle.scrollIntoViewIfNeeded();
  const start = (await handle.boundingBox())!;
  const target = (await region.locator(`[data-item-id="${targetId}"]`).boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  const targetY = target.y + target.height / 2;
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + Math.sign(targetY - y) * 10 }] });
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: targetY }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await client.detach(); }
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + Math.sign(targetY - y) * 10);
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(x, targetY, { steps: 10 });
    await page.mouse.up();
  }
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await region.getByRole("list", { name: "Sorting order", exact: true }).first().evaluate(async (list) => {
    await Promise.all(list.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
}

async function setupSortingPage(page: Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__sorting-fixture", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main></main></body></html>` }));
  await page.goto("/__sorting-fixture");
  await page.evaluate(() => {
    const w = window as unknown as Harness & Record<string, unknown>;
    const root = document.querySelector("main")!;
    for (const id of ["red", "teammate", "blue", "foreground"]) {
      const region = document.createElement("section");
      region.id = id; region.setAttribute("aria-label", `${id} view`); region.className = "flex h-[650px] flex-col border p-2";
      root.append(region);
    }
    type Saved = { answer?: string; correctOrder?: string[]; awardedPoints?: number };
    const docs: Record<string, Saved> = { "rooms/demo/rounds/sorting/answers/question-1": { correctOrder: ["a", "b", "c", "d"] } };
    const listeners = new Map<string, Set<(value: ReturnType<typeof snapshot>) => void>>();
    let closed = false;
    const path = (team: string) => `rooms/demo/teams/${team}/rounds/sorting/answers/question-1`;
    const snapshot = (key: string) => ({ data: () => docs[key], docs: [], metadata: { fromCache: false } });
    const emit = (key: string) => listeners.get(key)?.forEach((callback) => callback(snapshot(key)));
    w.sortingReads = []; w.sortingWrites = []; w.sortingAssetReads = [];
    w.sortingTransport = {
      snapshot,
      subscribe: (key: string, callback: (value: ReturnType<typeof snapshot>) => void) => {
        w.sortingReads.push(key);
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(callback);
        queueMicrotask(() => callback(snapshot(key)));
        return () => listeners.get(key)!.delete(callback);
      },
      setTeam: (team: string, order: string[]) => { docs[path(team)] = { answer: JSON.stringify(order) }; emit(path(team)); },
      freeze: () => {
        closed = true;
        for (const team of ["red", "blue"]) {
          const key = `rooms/demo/rounds/sorting/teamAnswers/${team}/answers/question-1`;
          if (docs[key]) continue;
          const answer = docs[path(team)]?.answer ?? "";
          const order: string[] = answer ? JSON.parse(answer) : [];
          docs[key] = { answer, awardedPoints: order.reduce((score, id, index) => score + Number(id === ["a", "b", "c", "d"][index]), 0) };
          emit(key);
        }
      },
    } as Harness["sortingTransport"];
    window.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string) as Harness["sortingWrites"][number];
      w.sortingWrites.push(body);
      if (w.rejectNextSortingWrite) {
        w.rejectNextSortingWrite = false;
        return new Response(JSON.stringify({ message: "Unable to save this order." }), { status: 503 });
      }
      if (closed) return new Response(JSON.stringify({ message: "Round is closed." }), { status: 409 });
      w.sortingTransport.setTeam(body.teamId, JSON.parse(body.answer));
      return new Response("{}", { status: 200 });
    };
  });
  await page.addScriptTag({ content: await bundle() });
}

for (const width of [1440, 390]) test(`sorting team workflow across foreground transitions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setupSortingPage(page);
  const red = page.getByRole("region", { name: "red view", exact: true });
  const teammate = page.getByRole("region", { name: "teammate view", exact: true });
  const blue = page.getByRole("region", { name: "blue view", exact: true });
  const foreground = page.getByRole("region", { name: "foreground view", exact: true });
  const correctPath = "rooms/demo/rounds/sorting/answers/question-1";
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toBeEnabled();
  await expect(red.getByRole("button", { name: /^Move item/ })).toHaveCount(0);
  const firstRow = red.locator('[data-item-id="a"]');
  const firstGrip = firstRow.getByRole("button", { name: "Reorder item 1", exact: true });
  const rowBounds = (await firstRow.boundingBox())!;
  const gripBounds = (await firstGrip.boundingBox())!;
  const textBounds = (await firstRow.getByText("A", { exact: true }).boundingBox())!;
  expect(rowBounds.height).toBe(32);
  expect(gripBounds.width).toBe(20);
  expect(gripBounds.height).toBe(20);
  expect(gripBounds.x - rowBounds.x).toBe(6);
  expect(textBounds.x - rowBounds.x).toBe(38);
  await expect(firstRow).toHaveText("A");
  const rowColor = await firstRow.evaluate((row) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(row).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const actual = [...context.getImageData(0, 0, 1, 1).data];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "rgba(212, 212, 216, 0.5)";
    context.fillRect(0, 0, 1, 1);
    return { actual, expected: [...context.getImageData(0, 0, 1, 1).data] };
  });
  expect(rowColor.actual).toEqual(rowColor.expected);
  await expect(firstRow).toHaveCSS("border-radius", "5px");
  const gripImage = firstGrip.locator('img');
  await expect(gripImage).toHaveAttribute("src", "/sorting-grip.svg");
  await expect.poll(() => gripImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(20);

  await expect(red.getByRole("button", { name: "Save order" })).toBeEnabled();
  await expect(red.getByRole("img", { name: "B", exact: true })).toBeVisible();
  await red.getByRole("button", { name: "Zoom image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "B", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close zoomed image", exact: true }).click();
  expect(await red.getByRole("button", { name: "Reorder item 1", exact: true }).evaluate((handle) => getComputedStyle(handle).touchAction)).toBe("none");
  await expect(foreground.getByRole("button", { name: "Save order" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads)).toEqual([
    "rooms/demo/teams/red/rounds/sorting/answers/question-1",
    "rooms/demo/teams/red/rounds/sorting/answers/question-1",
    "rooms/demo/teams/blue/rounds/sorting/answers/question-1",
  ]);
  const firstHandle = red.getByRole("button", { name: "Reorder item 1", exact: true });
  await firstHandle.focus();
  await page.keyboard.press("Space");
  await expect(firstHandle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 1.");
  await page.keyboard.press("Space");
  await expect(firstHandle).not.toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(0);
  await page.keyboard.press("Space");
  await expect(firstHandle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 1.");
  await page.keyboard.press("ArrowDown");
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 2.");
  await page.keyboard.press("Escape");
  await expect(firstHandle).not.toHaveAttribute("aria-pressed", "true");
  await expect(firstHandle).toBeFocused();
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(0);
  await red.getByRole("button", { name: "Save order" }).click();
  await expect(red.getByRole("status", { name: "Order saving status" })).toHaveText("Order saved");
  await dragItem(page, red, "b", "c", width === 390);
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => order(teammate)).toEqual(["a", "c", "b", "d"]);
  await expect(teammate.getByRole("status", { name: "Order saving status" })).toHaveText("Order saved");
  await dragItem(page, blue, "a", "b", width === 390);
  await expect(blue.getByRole("status", { name: "Order saving status" })).toHaveText("Order saved");
  await dragItem(page, blue, "c", "d", width === 390);
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);

  await red.getByRole("button", { name: "Foreground one", exact: true }).click();
  await expect(red.getByText("Foreground one", { exact: true })).toHaveCount(2);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, false, "Foreground two"));
  await expect(red.getByRole("button", { name: "Foreground two", exact: true })).toBeVisible();
  await expect(red.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);
  await red.getByRole("button", { name: "History sorting", exact: true }).click();
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, true, "Foreground two"));
  await expect(red.getByRole("status", { name: "Order saving status" })).toHaveText("Order saved");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);

  await page.evaluate(() => { (window as unknown as Harness).rejectNextSortingWrite = true; });
  await dragItem(page, red, "a", "c", width === 390);
  await expect(red.getByRole("alert")).toContainText("Unable to save this order.");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await red.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.evaluate(() => (window as unknown as Harness).expandSortingItem());
  const tallCard = red.locator('[data-item-id="b"]');
  await expect(tallCard.getByRole("img", { name: "Extra context", exact: true })).toBeVisible();
  expect((await tallCard.boundingBox())!.height).toBeGreaterThan((await red.locator('[data-item-id="d"]').boundingBox())!.height * 3 + 16);
  const writesBeforeTallDrag = await page.evaluate(() => (window as unknown as Harness).sortingWrites.length);
  const tallHandle = tallCard.getByRole("button", { name: /^Reorder item/ });
  await tallHandle.focus();
  await page.keyboard.press("Space");
  await expect(tallHandle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.keyboard.press("ArrowDown");
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 4.");
  await page.keyboard.press("Escape");
  await expect(tallHandle).not.toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites.length)).toBe(writesBeforeTallDrag);
  const keyboardHandle = teammate.locator('[data-item-id="b"]').getByRole("button", { name: /^Reorder item/ });
  await keyboardHandle.focus();
  await page.keyboard.press("Space");
  await expect(keyboardHandle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(teammate.locator('[aria-live="assertive"]')).toHaveText("Over position 3.");
  await page.keyboard.press("ArrowUp");
  await expect(teammate.locator('[aria-live="assertive"]')).toHaveText("Over position 2.");
  await page.keyboard.press("Space");
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  await expect.poll(() => order(teammate)).toEqual(["a", "b", "c", "d"]);
  await expect(keyboardHandle).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads.includes("rooms/demo/rounds/sorting/answers/question-1"))).toBe(false);

  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed", false, false, "Foreground two"));
  await expect(red.getByText("Submissions closed · 4 / 4 points", { exact: true })).toBeVisible();
  await expect(blue.getByText("Submissions closed · 0 / 4 points", { exact: true })).toBeVisible();
  await expect(red.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);
  await expect(red.getByRole("button", { name: "Save order" })).toHaveCount(0);
  await expect(red.getByRole("region", { name: "Correct order", exact: true })).toHaveCount(0);
  // Frozen submissions stay intact even if a stale live draft changes after closing.
  await page.evaluate(() => (window as unknown as Harness).sortingTransport.setTeam("red", ["d", "c", "b", "a"]));
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads)).not.toContain(correctPath);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed", true, false, "Foreground two"));
  await expect(red.getByRole("region", { name: "Correct order", exact: true })).toBeVisible();
  await expect.poll(() => order(red.getByRole("region", { name: "Correct order", exact: true }))).toEqual(["a", "b", "c", "d"]);
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingReads.includes("rooms/demo/rounds/sorting/answers/question-1"))).toBe(true);
});


test("sorting list matches the Figma frame", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setupSortingPage(page);
  await page.evaluate(() => (window as unknown as Harness).renderSortingDesign());
  const panel = page.getByRole("region", { name: "Сортуємо", exact: true });
  await expect(panel.getByRole("heading", { name: "Від найстарішого до найновішого" })).toBeVisible();
  await expect(panel.locator('[data-item-id="0"]')).toHaveCSS("height", "32px");
  await expect(panel.getByRole("button", { name: "Reorder item 1", exact: true }).locator('img')).toBeVisible();
  const gripImages = panel.locator('button[title="Drag to reorder"] img');
  await expect(gripImages).toHaveCount(8);
  await expect.poll(() => gripImages.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 20))).toBe(true);
  expect((await panel.locator('[data-item-id="0"]').boundingBox())!.width).toBeCloseTo(372, 0);
  await panel.screenshot({ path: testInfo.outputPath("sorting-figma.png") });
});
