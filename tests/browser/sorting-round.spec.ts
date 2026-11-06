import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import type { SortingEdit } from "../../types/sorting";

test.use({ colorScheme: "light" });

async function bundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import RoomRoundsPanel from './app/[room]/room-rounds-panel';
      import { SortingRound } from './lib/components/sorting-round';
      import QuizRound from './lib/components/quiz-round';
      import { HarnessAuthProvider } from '@/app/providers/firebase-auth-provider';
      import { applySortingEdit } from './types/sorting';
      import { closeSortingRound } from './lib/hooks/use-sorting-order';
      import { getActiveRounds } from './lib/hooks/use-room-rounds';
      window.applySortingEdit = applySortingEdit;
      const criterion = 'Order events from earliest to latest';
      const questions = [
        {id:'a',text:'A'},
        {id:'b',text:'B',media:{storagePath:'images/b.svg',filename:'b.svg'}},
        {id:'c',text:'C'}, {id:'d',text:'D'}
      ];
      const roots = ['red', 'teammate', 'blue', 'foreground'].map(id => createRoot(document.getElementById(id)));
      let generation = 0;
      window.renderSortingViews = (state = 'active', reveal = false, reconnect = false, foreground = 'Foreground one') => {
        if (reconnect) generation++;
        if (state === 'closed') {window.sortingTransport.freeze();closeSortingRound('demo','sorting');}
        flushSync(() => {
          ['red','red','blue'].forEach((teamId,index) => roots[index].render(
            <React.Profiler id={teamId+index} onRender={() => {
              if (index === 0 && window.renderedOrders) window.renderedOrders.push([...document.getElementById('red').querySelectorAll('ol[aria-label="Sorting order"] > li')].map(row => row.getAttribute('data-item-id')));
            }}><HarnessAuthProvider uid={['red-player','red-teammate','blue-player'][index]}>
              <RoomRoundsPanel key={generation} roomSlug="demo" teamId={teamId} rounds={getActiveRounds([
                {id:'sorting',type:'sorting',title:'History sorting',roundNumber:1,state,criterion,questions,presenting:reveal ? {round:'sorting',question:null,withAnswer:true}:null},
                {id:'foreground',type:'text',title:foreground,roundNumber:2,state:'active',questions:[],emptyLabel:foreground}
              ])} />
            </HarnessAuthProvider></React.Profiler>));
          roots[3].render(<HarnessAuthProvider uid="host"><SortingRound key={generation} roomSlug="demo" roundId="sorting" criterion={criterion} questions={questions} state={state} readOnly reveal={reveal} /></HarnessAuthProvider>);
        });
      };
      window.expandSortingItem = () => {
        questions[1].text = 'B\\n' + Array.from({length:7}, (_, index) => 'Extra context ' + index).join('\\n');
        window.renderSortingViews();
      };
      window.renderSortingDesign = () => {
        document.getElementById('red').className = 'flex h-[337px] w-[437px] flex-col';
        ['teammate','blue','foreground'].forEach(id => { document.getElementById(id).style.display = 'none'; });
        window.sortingTransport.initializeDesign();
        flushSync(() => roots[0].render(<HarnessAuthProvider uid="design-player"><QuizRound id="sorting-design" type="sorting" title="Сортуємо" roundNumber={1}
          state="active" roomSlug="demo" teamId="red" criterion="Від найстарішого до найновішого" questions={
            ['IKEA','Samsung','Sony','Disney','LEGO','Apple','Nintendo','McDonalds'].map((text,index) => ({id:String(index),text}))} /></HarnessAuthProvider>));
      };
      window.renderSortingViews();`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "sorting-test-transport", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "sorting-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "sorting-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/');
          export const collection = doc; export const query=path=>path; export const orderBy=()=>null;
          export const setDoc = () => { throw new Error('Direct answer writes are forbidden'); };
          export const onSnapshot = (path, optionsOrCallback, callback) => window.sortingTransport.subscribe(path, typeof optionsOrCallback === 'function' ? optionsOrCallback : callback);
          export const getDocFromServer = () => { throw new Error('Sorting must not force a server read after saving'); };` };
        if (args.path === "firebase/storage") return { contents: `
          export const getStorage = () => ({});
          export const ref = (_, path) => path;
          export const getDownloadURL = async path => { window.sortingAssetReads.push(path); return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>'); };` };
        if (args.path.includes("firebase-auth-provider")) return { resolveDir: process.cwd(), contents: `
          import React from 'react';
          const Auth = React.createContext('unknown');
          export const HarnessAuthProvider = ({uid,children}) => React.createElement(Auth.Provider,{value:uid},children);
          export const useFirebaseAuth = () => { const uid = React.useContext(Auth); const getToken = React.useCallback(async () => uid,[uid]); return {getToken,user:{uid}}; };` };
        return { contents: `export const getClientFirestore = () => ({}); export const getFirebaseClientApp = () => ({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Write = { teamId: string; edit: SortingEdit; actor: string };
type Harness = {
  renderSortingDesign: () => void;
  expandSortingItem: () => void;
  renderSortingViews: (state?: "active" | "closed", reveal?: boolean, reconnect?: boolean, foreground?: string) => void;
  sortingReads: string[];
  sortingAssetReads: string[];
  sortingWrites: Write[];
  sortingAckReads: string[];
  sortingPointerListeners: number;
  holdNextSortingAck: boolean;
  holdSortingSnapshots: boolean;
  failNextSortingWrite: "before" | "after" | "reject" | null;
  applySortingEdit: (order: readonly string[], edit: SortingEdit) => string[];
  sortingTransport: {
    setTeam: (team: string, order: string[]) => void;
    team: (team: string) => { order: string[]; revision: number };
    releaseAcks: () => void;
    releaseSnapshots: (latestFirst?: boolean) => void;
    initializeDesign: () => void;
    freeze: () => void;
    listenerCount: () => number;
  };
};
const view = (page: Page, name: string) => page.getByRole("region", { name: `${name} view`, exact: true });
const order = (region: Locator) => region.getByRole("list", { name: "Sorting order", exact: true }).first().locator(":scope > li").evaluateAll((items) => items.map((item) => item.getAttribute("data-item-id")));
const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function setupSortingPage(page: Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__sorting-fixture", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main></main></body></html>` }));
  await page.goto("/__sorting-fixture");
  await page.evaluate(() => {
    const w = window as unknown as Harness & Record<string, unknown>;
    // dnd-kit deliberately retains its click suppression listener briefly after
    // a pointer drop. Observe its teardown before clicking unrelated controls.
    const pointerClicks = new Set<EventListenerOrEventListenerObject>();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    w.sortingPointerListeners = 0;
    document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === "click" && listener) { pointerClicks.add(listener); w.sortingPointerListeners = pointerClicks.size; }
      add(type, listener, options);
    };
    document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      if (type === "click" && listener) { pointerClicks.delete(listener); w.sortingPointerListeners = pointerClicks.size; }
      remove(type, listener, options);
    };
    const root = document.querySelector("main")!;
    for (const id of ["red", "teammate", "blue", "foreground"]) {
      const region = document.createElement("section");
      region.id = id; region.setAttribute("aria-label", `${id} view`); region.className = "flex h-[650px] flex-col border p-2";
      root.append(region);
    }
    type Saved = { order?: string[]; revision?: number; correctOrder?: string[]; awardedPoints?: number; pointsByQuestion?: Record<string, number>; graded?: boolean };
    const path = (team: string, round = "sorting") => `rooms/demo/teams/${team}/rounds/${round}`;
    const docs: Record<string, Saved> = {
      "rooms/demo/rounds/sorting/answers/order": { correctOrder: ["a", "b", "c", "d"] },
      [path("red")]: { order: ["a", "b", "c", "d"], revision: 0 },
      [path("blue")]: { order: ["a", "b", "c", "d"], revision: 0 },
    };
    const snapshot = (key: string, data = docs[key]) => ({ data: () => structuredClone(data), exists: () => data !== undefined, docs: [], metadata: { fromCache: false } });
    type Callback = (value: ReturnType<typeof snapshot>) => void;
    const listeners = new Map<string, Set<Callback>>();
    const heldSnapshots: Array<{ key: string; data: Saved }> = [];
    const heldAcks: Array<() => void> = [];
    const receipts = new Map<string, { edit: string; revision: number }>();
    let closed = false;
    const emit = (key: string, data = docs[key]) => {
      if (w.holdSortingSnapshots) heldSnapshots.push({ key, data: structuredClone(data) });
      else listeners.get(key)?.forEach((callback) => callback(snapshot(key, data)));
    };
    w.sortingReads = []; w.sortingWrites = []; w.sortingAssetReads = []; w.sortingAckReads = [];
    w.sortingTransport = {
      subscribe: (key: string, callback: Callback) => {
        w.sortingReads.push(key);
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(callback);
        const value = snapshot(key);
        queueMicrotask(() => callback(value));
        return () => listeners.get(key)!.delete(callback);
      },
      listenerCount: () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
      initializeDesign: () => { docs[path("red", "sorting-design")] = { order: Array.from({ length: 8 }, (_, index) => String(index)), revision: 0 }; },
      team: (team: string) => structuredClone(docs[path(team)]) as { order: string[]; revision: number },
      setTeam: (team: string, order: string[]) => { docs[path(team)] = { order, revision: (docs[path(team)].revision ?? 0) + 1 }; emit(path(team)); },
      releaseAcks: () => { heldAcks.splice(0).forEach((release) => release()); },
      releaseSnapshots: (latestFirst = false) => {
        w.holdSortingSnapshots = false;
        const events = heldSnapshots.splice(0);
        if (latestFirst) events.reverse();
        events.forEach(({ key, data }) => listeners.get(key)?.forEach((callback) => callback(snapshot(key, data))));
      },
      freeze: () => {
        closed = true;
        for (const team of ["red", "blue"]) {
          const key = `rooms/demo/rounds/sorting/teamAnswers/${team}`;
          if (docs[key]) continue;
          const current = docs[path(team)];
          const order = current.order!;
          docs[key] = { order: [...order], revision: current.revision, graded: true,
            pointsByQuestion: Object.fromEntries(order.map((id, index) => [id, Number(id === ["a", "b", "c", "d"][index])])),
            awardedPoints: order.reduce((score, id, index) => score + Number(id === ["a", "b", "c", "d"][index]), 0) };
          emit(key);
        }
      },
    } as Harness["sortingTransport"];
    window.fetch = async (url, options) => {
      if (!String(url).endsWith("/rounds/sorting/answer")) throw new Error("Expected a round-level sorting answer endpoint.");
      const body = JSON.parse(options!.body as string) as Omit<Write, "actor">;
      const actor = new Headers(options?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "unknown";
      w.sortingWrites.push({ ...body, actor });
      const failure = w.failNextSortingWrite;
      w.failNextSortingWrite = null;
      if (failure === "before" || failure === "reject") return new Response(JSON.stringify({ message: "Unable to save this edit." }), { status: failure === "reject" ? 400 : 503 });
      const receiptKey = `${body.teamId}:${body.edit.id}`;
      let receipt = receipts.get(receiptKey);
      if (!receipt) {
        if (closed) return new Response(JSON.stringify({ message: "Round is closed.", code: "round-closed" }), { status: 409 });
        const current = docs[path(body.teamId)];
        const revision = current.revision! + 1;
        const order = w.applySortingEdit(current.order!, body.edit);
        docs[path(body.teamId)] = { order, revision };
        receipt = { edit: JSON.stringify(body.edit), revision };
        receipts.set(receiptKey, receipt);
        emit(path(body.teamId));
      }
      if (receipt.edit !== JSON.stringify(body.edit)) return new Response(JSON.stringify({ message: "Edit ID reused." }), { status: 409 });
      if (failure === "after") return new Response(JSON.stringify({ message: "Save acknowledgement was lost." }), { status: 503 });
      if (w.holdNextSortingAck) {
        w.holdNextSortingAck = false;
        await new Promise<void>((resolve) => heldAcks.push(resolve));
      }
      const response = new Response(JSON.stringify({ editId: body.edit.id, revision: receipt.revision }), { status: 200,
        headers: { "Server-Timing": "auth;dur=1, save;dur=2" } });
      const json = response.json.bind(response);
      response.json = async () => { const value = await json(); w.sortingAckReads.push(body.edit.id); return value; };
      return response;
    };
  });
  await page.addScriptTag({ content: await bundle() });
  await expect(view(page, "red").getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "false");
}

async function startMouseDrag(page: Page, region: Locator, id: string, area: "text" | "image" | "blank" = "text") {
  const row = region.locator(`[data-item-id="${id}"]`);
  const handle = row.getByRole("button", { name: /^Reorder item/ });
  await region.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await row.scrollIntoViewIfNeeded();
  const target = area === "image" ? row.getByRole("img").first() : area === "text" ? row.locator("p").first() : row;
  const bounds = (await target.boundingBox())!;
  const x = area === "blank" ? bounds.x + bounds.width - 8 : bounds.x + Math.min(25, bounds.width / 2);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y);
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  return { row, handle, x, y };
}

async function dragItem(page: Page, region: Locator, id: string, targetId: string, touch = false, area: "text" | "image" | "blank" = "text") {
  const row = region.locator(`[data-item-id="${id}"]`);
  const handle = row.getByRole("button", { name: /^Reorder item/ });
  await region.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await row.scrollIntoViewIfNeeded();
  const destination = (await region.locator(`[data-item-id="${targetId}"]`).boundingBox())!;
  if (touch) {
    const source = area === "image" ? row.getByRole("img").first() : row.locator("p").first();
    const start = (await source.boundingBox())!;
    const x = start.x + Math.min(25, start.width / 2), y = start.y + start.height / 2;
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      // Activation is the actual product hold gesture, observed rather than a fixed test sleep.
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: destination.y + destination.height / 2 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await client.detach(); }
  } else {
    const start = await startMouseDrag(page, region, id, area);
    await page.mouse.move(start.x, destination.y + destination.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await region.getByRole("list", { name: "Sorting order", exact: true }).first().evaluate(async (list) => {
    await Promise.allSettled(list.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingPointerListeners)).toBe(0);
}

async function pickUpWithKeyboard(page: Page, handle: Locator) {
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await nextFrame(page);
  const label = await handle.getAttribute("aria-label");
  await expect.poll(() => handle.evaluate((element) => element.closest("section")?.querySelector('[aria-live="assertive"]')?.textContent)).toBe(`Over position ${label!.replace("Reorder item ", "")}.`);
}

async function rgba(region: Locator) {
  return region.evaluate((element) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
}

for (const width of [1440, 390]) test(`sorting team workflow across foreground transitions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red"), teammate = view(page, "teammate"), blue = view(page, "blue"), foreground = view(page, "foreground");
  const firstRow = red.locator('[data-item-id="a"]'), firstGrip = firstRow.getByRole("button", { name: "Reorder item 1", exact: true });
  await page.mouse.move(0, 0);
  const rowBounds = (await firstRow.boundingBox())!, gripBounds = (await firstGrip.boundingBox())!;
  expect(rowBounds.height).toBe(32); expect(gripBounds.width).toBe(20); expect(gripBounds.height).toBe(20);
  expect(gripBounds.x - rowBounds.x).toBe(6);
  expect((await firstRow.getByText("A", { exact: true }).boundingBox())!.x - rowBounds.x).toBe(38);
  await expect(firstRow).toHaveText("A"); await expect(firstRow).toHaveCSS("border-radius", "5px");
  expect(await rgba(firstRow)).toEqual([244, 244, 245, 255]);
  await firstRow.hover();
  const hovered = await rgba(firstRow);
  expect(hovered.slice(0, 3).every((channel, index) => Math.abs(channel - [212, 212, 216][index]) <= 1)).toBe(true);
  expect(hovered[3]).toBe(128);
  await expect(firstGrip.locator("img")).toHaveAttribute("src", "/sorting-grip.svg");
  await expect.poll(() => firstGrip.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(20);
  await expect(page.getByRole("button", { name: "Save order", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Order saving status" })).toHaveCount(0);
  await expect(page.getByText(/^(Saving…|Order saved)$/)).toHaveCount(0);
  await expect(foreground.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);
  await red.getByRole("button", { name: "Zoom image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "B", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close zoomed image", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(0);
  expect(await firstRow.evaluate((row) => getComputedStyle(row).touchAction)).toBe("pan-y");

  await pickUpWithKeyboard(page, firstGrip);
  await page.keyboard.press("Space");
  await expect(firstGrip).not.toHaveAttribute("aria-pressed", "true");
  await pickUpWithKeyboard(page, firstGrip);
  await page.keyboard.press("ArrowDown");
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 2.");
  await page.keyboard.press("Escape");
  await expect(firstGrip).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(0);

  await dragItem(page, red, "b", "c", width === 390, "image");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => order(teammate)).toEqual(["a", "c", "b", "d"]);
  await dragItem(page, blue, "a", "b", width === 390);
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingTransport.team("blue").revision)).toBe(1);
  await dragItem(page, blue, "c", "d", width === 390);
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);
  await red.getByRole("button", { name: "Foreground one", exact: true }).click();
  await expect(red.getByText("Foreground one", { exact: true })).toHaveCount(2);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, false, "Foreground two"));
  await red.getByRole("button", { name: "History sorting", exact: true }).click();
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, true, "Foreground two"));
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);

  await page.evaluate(() => (window as unknown as Harness).expandSortingItem());
  const tallCard = teammate.locator('[data-item-id="b"]');
  await expect(tallCard).toContainText("Extra context 6");
  expect((await tallCard.boundingBox())!.height).toBeGreaterThan((await teammate.locator('[data-item-id="d"]').boundingBox())!.height * 3 + 16);
  const keyboardHandle = tallCard.getByRole("button", { name: /^Reorder item/ });
  await pickUpWithKeyboard(page, keyboardHandle);
  await page.keyboard.press("ArrowDown");
  await expect(teammate.locator('[aria-live="assertive"]')).toHaveText("Over position 4.");
  await page.keyboard.press("Escape");
  await pickUpWithKeyboard(page, keyboardHandle);
  await page.keyboard.press("ArrowUp");
  await expect(teammate.locator('[aria-live="assertive"]')).toHaveText("Over position 2.");
  await page.keyboard.press("Space");
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  await expect(keyboardHandle).toBeFocused();
  const correctPath = "rooms/demo/rounds/sorting/answers/order";
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads)).not.toContain(correctPath);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed"));
  for (const region of [red, teammate, blue]) {
    await expect(region.getByRole("button", { name: "History sorting", exact: true })).toHaveCount(0);
    await expect(region.getByRole("list", { name: "Sorting order", exact: true })).toHaveCount(0);
    await expect(region.getByRole("region", { name: "Foreground one", exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads)).not.toContain(correctPath);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed", true));
  await expect(foreground.getByRole("region", { name: "Correct order", exact: true })).toBeVisible();
  await expect.poll(() => order(foreground)).toEqual(["a", "b", "c", "d"]);
  await expect(foreground.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);

});

test("rapid relative edits remain interactive, merge teammates, and survive a tab switch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red"), teammate = view(page, "teammate");
  await page.evaluate(() => { (window as unknown as Harness).holdNextSortingAck = true; });
  await dragItem(page, red, "a", "c");
  await expect.poll(() => order(red)).toEqual(["b", "c", "a", "d"]);
  await expect(red.getByRole("status", { name: "Order saving status" })).toHaveCount(0);
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "false");
  await dragItem(page, red, "d", "b", false, "blank");
  await expect.poll(() => order(red)).toEqual(["d", "b", "c", "a"]);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites.length)).toBe(1);
  await dragItem(page, teammate, "b", "a");
  await expect.poll(() => order(teammate)).toEqual(["c", "a", "b", "d"]);
  await expect.poll(() => order(red)).toEqual(["c", "a", "d", "b"]);
  await red.getByRole("button", { name: "Foreground one", exact: true }).click();
  await expect(red.getByRole("list", { name: "Sorting order", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Harness).sortingTransport.releaseAcks());
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingTransport.team("red"))).toEqual({ order: ["c", "a", "d", "b"], revision: 3 });
  await expect.poll(() => order(teammate)).toEqual(["c", "a", "d", "b"]);
  await red.getByRole("button", { name: "History sorting", exact: true }).click();
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => order(red)).toEqual(["c", "a", "d", "b"]);
  const writes = await page.evaluate(() => (window as unknown as Harness).sortingWrites);
  expect(writes.map((write) => write.actor)).toEqual(["red-player", "red-teammate", "red-player"]);
  expect(writes.every((write) => !Object.hasOwn(write, "answer") && !!write.edit.id)).toBe(true);
});

test("a new snapshot retires acknowledged edits without an intermediate reordered render", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red");
  await page.evaluate(() => { (window as unknown as Harness).holdSortingSnapshots = true; });
  await dragItem(page, red, "a", "b");
  await dragItem(page, red, "b", "c");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingAckReads.length)).toBe(2);
  await expect(red.getByRole("status", { name: "Order saving status" })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { renderedOrders: string[][] }).renderedOrders = []; });
  await page.evaluate(() => (window as unknown as Harness).sortingTransport.releaseSnapshots(true));
  await expect.poll(() => page.evaluate(() => (window as unknown as { renderedOrders: string[][] }).renderedOrders.length)).toBeGreaterThan(0);
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  const renders = await page.evaluate(() => (window as unknown as { renderedOrders: string[][] }).renderedOrders);
  expect(renders.length).toBeGreaterThan(0);
  expect(renders.every((render) => JSON.stringify(render) === '["a","c","b","d"]')).toBe(true);
});

test("lost acknowledgements retry the same edit without reapplying over newer teammate moves", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red"), teammate = view(page, "teammate");
  await page.evaluate(() => { (window as unknown as Harness).failNextSortingWrite = "after"; });
  await dragItem(page, red, "a", "c");
  await expect(red.getByRole("alert")).toContainText("Save acknowledgement was lost.");
  await dragItem(page, teammate, "a", "b");
  await expect.poll(() => order(teammate)).toEqual(["a", "b", "c", "d"]);
  await red.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "false");
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  const writes = await page.evaluate(() => (window as unknown as Harness).sortingWrites);
  expect(writes[0].edit.id).toBe(writes[2].edit.id);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingTransport.team("red").revision)).toBe(2);
  await page.evaluate(() => { (window as unknown as Harness).failNextSortingWrite = "reject"; });
  await dragItem(page, red, "a", "b");
  await expect(red.getByRole("alert")).toContainText("Unable to save this edit.");
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  await red.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(red.getByRole("alert")).toHaveCount(0);
});

test("a server close disables further moves before round metadata arrives", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red");
  await page.evaluate(() => (window as unknown as Harness).sortingTransport.freeze());
  await dragItem(page, red, "a", "b");
  await expect(red.getByRole("alert")).toContainText("The round closed before all changes were confirmed.");
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "true");
  await red.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(red.getByRole("alert")).toHaveCount(0);
  await expect(red.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(1);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed"));
  await expect(red.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);
  await expect(red.getByRole("list", { name: "Sorting order", exact: true })).toHaveCount(0);
  await expect(red.getByRole("button", { name: "History sorting", exact: true })).toHaveCount(0);
});

test("hovering a row gap keeps the dragged item at its insertion position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red");
  await red.getByRole("list", { name: "Sorting order", exact: true }).scrollIntoViewIfNeeded();
  const original = (await red.locator('[data-item-id="a"]').boundingBox())!;
  const c = (await red.locator('[data-item-id="c"]').boundingBox())!, d = (await red.locator('[data-item-id="d"]').boundingBox())!;
  const drag = await startMouseDrag(page, red, "a");
  await page.mouse.move(drag.x, c.y + c.height / 2, { steps: 10 });
  await expect(red.locator('[aria-live="assertive"]')).toHaveText("Over position 3.");
  await page.mouse.move(drag.x, (c.y + c.height + d.y) / 2, { steps: 4 });
  await expect(drag.handle).toHaveAttribute("aria-pressed", "true");
  expect((await drag.row.boundingBox())!.y).toBeGreaterThan(original.y + 50);
  await expect(red.locator('[aria-live="assertive"]')).not.toHaveText("Outside the sorting list.");
  await page.mouse.up();
  await expect.poll(() => order(red)).toEqual(["b", "c", "a", "d"]);
});

test("a touch swipe before the hold threshold scrolls without submitting a move", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setupSortingPage(page);
  const red = view(page, "red");
  const bounds = (await red.locator('[data-item-id="b"]').boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + 40;
  const before = await page.evaluate(() => scrollY);
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const distance of [20, 40, 70, 100]) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - distance }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await client.detach(); }
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(0);
  await expect(red.locator('[data-dragging="true"]')).toHaveCount(0);
});

test("sorting list keeps compact Figma geometry with lighter idle rows", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await setupSortingPage(page);
  await page.evaluate(() => (window as unknown as Harness).renderSortingDesign());
  const panel = page.getByRole("region", { name: "Сортуємо", exact: true });
  await expect(panel.getByRole("heading", { name: "Від найстарішого до найновішого" })).toBeVisible();
  await expect(panel.locator('[data-item-id="0"]')).toHaveCSS("height", "32px");
  const gripImages = panel.locator('button[title="Drag to reorder"] img');
  await expect(gripImages).toHaveCount(8);
  await expect.poll(() => gripImages.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 20))).toBe(true);
  expect((await panel.locator('[data-item-id="0"]').boundingBox())!.width).toBeCloseTo(372, 0);
  await expect(panel.getByRole("button", { name: "Save order", exact: true })).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath("sorting-figma.png") });
});


test("closing retires paused edits even when their round tab is unmounted", async ({page}) => {
  await setupSortingPage(page);
  const red=view(page,"red");
  await page.evaluate(() => { (window as unknown as Harness).failNextSortingWrite="before"; });
  await dragItem(page,red,"a","b");
  await expect(red.getByRole("alert")).toContainText("Unable to save this edit.");
  await red.getByRole("button",{name:"Foreground one",exact:true}).click();
  await expect(red.getByRole("list",{name:"Sorting order",exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingTransport.listenerCount())).toBe(3);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed"));
  await expect.poll(() => page.evaluate(() => (window as unknown as Harness).sortingTransport.listenerCount())).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingWrites)).toHaveLength(1);
});
