import { expect, test, type Locator } from "@playwright/test";
import { build } from "esbuild";

async function bundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import RoomRoundsPanel from './app/[room]/room-rounds-panel';
      import { SortingRound } from './lib/components/sorting-round';
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
        ['red','red','blue'].forEach((teamId,index) => roots[index].render(<RoomRoundsPanel
          key={generation} roomSlug="demo" teamId={teamId} rounds={[
            {id:'sorting',type:'sorting',title:'History sorting',roundNumber:1,state,questions:[question],presenting:reveal ? {round:'sorting',withAnswer:true}:null},
            {id:'foreground',type:'text',title:foreground,roundNumber:2,questions:[],emptyLabel:foreground}
          ]} />));
        roots[3].render(<SortingRound key={generation} roomSlug="demo" roundId="sorting" question={question} state={state} readOnly reveal={reveal} />);
      };
      window.renderSortingViews();`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
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
  renderSortingViews: (state?: "active" | "closed", reveal?: boolean, reconnect?: boolean, foreground?: string) => void;
  sortingReads: string[];
  sortingAssetReads: string[];
  sortingWrites: Array<{ teamId: string; answer: string }>;
  rejectNextSortingWrite: boolean;
  sortingTransport: { setTeam: (team: string, order: string[]) => void };
};
const order = (region: Locator) => region.getByRole("list", { name: "Sorting order", exact: true }).first().locator(":scope > li").evaluateAll((items) => items.map((item) => item.getAttribute("data-item-id")));

for (const width of [1440, 390]) test(`sorting team workflow across foreground transitions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
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
  const red = page.getByRole("region", { name: "red view", exact: true });
  const teammate = page.getByRole("region", { name: "teammate view", exact: true });
  const blue = page.getByRole("region", { name: "blue view", exact: true });
  const foreground = page.getByRole("region", { name: "foreground view", exact: true });
  const correctPath = "rooms/demo/rounds/sorting/answers/question-1";
  await expect(red.getByRole("button", { name: "Save order" })).toBeEnabled();
  await expect(red.getByRole("img", { name: "B", exact: true })).toBeVisible();
  await expect(foreground.getByRole("button", { name: "Save order" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads)).toEqual([
    "rooms/demo/teams/red/rounds/sorting/answers/question-1",
    "rooms/demo/teams/red/rounds/sorting/answers/question-1",
    "rooms/demo/teams/blue/rounds/sorting/answers/question-1",
  ]);
  await red.getByRole("button", { name: "Save order" }).click();
  await expect(red.getByRole("status")).toHaveText("Order saved");
  await red.getByRole("button", { name: "Move item b down", exact: true }).click();
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => order(teammate)).toEqual(["a", "c", "b", "d"]);
  await expect(teammate.getByRole("status")).toHaveText("Order saved");
  await blue.getByRole("button", { name: "Move item a down", exact: true }).click();
  await expect(blue.getByRole("status")).toHaveText("Order saved");
  await blue.getByRole("button", { name: "Move item c down", exact: true }).click();
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);

  await red.getByRole("button", { name: "Foreground one", exact: true }).click();
  await expect(red.getByText("Foreground one", { exact: true })).toHaveCount(2);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, false, "Foreground two"));
  await expect(red.getByRole("button", { name: "Foreground two", exact: true })).toBeVisible();
  await expect(red.getByRole("button", { name: "Move item a down", exact: true })).toHaveCount(0);
  await red.getByRole("button", { name: "History sorting", exact: true }).click();
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("active", false, true, "Foreground two"));
  await expect(red.getByRole("status")).toHaveText("Order saved");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await expect.poll(() => order(blue)).toEqual(["b", "a", "d", "c"]);

  await page.evaluate(() => { (window as unknown as Harness).rejectNextSortingWrite = true; });
  await red.getByRole("button", { name: "Move item a down", exact: true }).click();
  await expect(red.getByRole("alert")).toContainText("Unable to save this order.");
  await expect.poll(() => order(red)).toEqual(["a", "c", "b", "d"]);
  await red.getByRole("button", { name: "Dismiss", exact: true }).click();
  await teammate.getByRole("button", { name: "Move item b up", exact: true }).click();
  await expect.poll(() => order(red)).toEqual(["a", "b", "c", "d"]);
  await expect.poll(() => order(teammate)).toEqual(["a", "b", "c", "d"]);
  expect(await page.evaluate(() => (window as unknown as Harness).sortingReads.includes("rooms/demo/rounds/sorting/answers/question-1"))).toBe(false);

  await page.evaluate(() => (window as unknown as Harness).renderSortingViews("closed", false, false, "Foreground two"));
  await expect(red.getByText("Submissions closed · 4 / 4 points", { exact: true })).toBeVisible();
  await expect(blue.getByText("Submissions closed · 0 / 4 points", { exact: true })).toBeVisible();
  await expect(red.getByRole("button", { name: /Move item/ })).toHaveCount(0);
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
