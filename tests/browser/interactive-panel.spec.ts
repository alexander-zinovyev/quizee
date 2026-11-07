import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

// Keep native scrollbars visible for the presentation appearance regressions.
test.use({ colorScheme: "light", launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function bundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import RoomContent from './app/[room]/room-content';
      import {RoundStage} from './lib/components/room/round-stage';
      import {HarnessAuthProvider} from '@/app/providers/firebase-auth-provider';
      import {applySortingEdit} from './types/sorting';
      window.applySortingEdit=applySortingEdit;
      const roots=['first','teammate','host'].map(id=>createRoot(document.getElementById(id)));
      const teams=[{id:'red',name:'Team Red',members:[]},{id:'blue',name:'Team Blue',members:[]}];
      const names={first:'First',teammate:'Teammate',host:'Host'};
      let generation=0;
      window.renderRoom=(reconnect=false)=>{
        if(reconnect) generation++;
        flushSync(()=>['first','teammate','host'].forEach((uid,index)=>roots[index].render(
          <HarnessAuthProvider key={generation} uid={uid}>
            <RoomContent roomSlug="demo" teams={teams} hostMember={{id:'host',name:'Host'}}
              isHost={uid==='host'} viewerTeamId={uid==='host'?null:'red'} viewerName={names[uid]}
              memberNames={names} presenting={window.roomTransport.presentation()}/>
          </HarnessAuthProvider>)));
      };
      window.renderStandaloneStage=()=>{
        const round={id:'preview',type:'text',title:'Builder preview',order:0,state:'active'};
        const kind={isImage:false,isAudio:false,isVideo:false};
        const question={id:'q1',order:0,displayPrompt:'Preview question',prompt:Array.from({length:35},(_,index)=>'Preview line '+index).join('\\n')};
        roots[2].render(<section aria-label="Standalone presentation" style={{height:240,width:600,display:'flex',flexDirection:'column',backgroundColor:'black'}}>
          <RoundStage displayRoundMeta={round} presentingRoundMeta={round} presenting={{round:'preview',question:'q1'}} presentingQuestion={question}
            gradingMatrix={[]} gradingTeamIndex={0} setGradingTeamIndex={()=>{}} gradeAnswer={()=>{}} finalizeScores={()=>{}}
            answerMediaError={null} mediaError={null} isAnswerMediaLoading={false} isMediaLoading={false} isPresentingImageRound={false}
            mediaKind={kind} answerMediaKind={kind} mediaVolume={0.2} presentingMedia={null} presentingMediaUrl={null}
            presentingAnswer={null} presentingAnswerMedia={null} presentingAnswerMediaUrl={null}/>
        </section>);
      };
      window.renderRoom();
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic",
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "room-fixture", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider|@\/lib\/components\/(member|team))$/ }, (args) => ({ path: args.path, namespace: "room-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "room-mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          const path=(base,...parts)=>[...(typeof base==='string'?[base]:[]),...parts].join('/');
          export const doc=path;export const collection=path;export const query=value=>value;export const orderBy=()=>null;
          export const onSnapshot=(key,options,callback)=>window.roomTransport.subscribe(key,typeof options==='function'?options:callback);
          export const getDoc=async key=>window.roomTransport.snapshot(key);
          export const getDocFromServer=getDoc;export const getDocs=getDoc;
          export const serverTimestamp=()=>({fixtureTimestamp:true});
          export const Timestamp={fromDate:date=>date};
          export const addDoc=async(key,data)=>window.roomTransport.add(key,data);
          export const setDoc=async(key,data)=>window.roomTransport.set(key,data);
          export const updateDoc=setDoc;
          export const writeBatch=()=>({set:()=>{throw new Error('Unexpected host batch');},commit:()=>{throw new Error('Unexpected host batch');}});
          export const runTransaction=()=>{throw new Error('Image matching is covered in image-matching.spec.ts');};
        ` };
        if (args.path === "firebase/storage") return { contents: `
          export const getStorage=()=>({});export const ref=(_,path)=>path;
          export const getDownloadURL=async path=>{window.roomTransport.mediaReads.push(path);return window.roomTransport.image;};` };
        if (args.path.includes("firebase-auth-provider")) return { resolveDir: process.cwd(), contents: `
          import React from 'react';const Auth=React.createContext('unknown');
          export const HarnessAuthProvider=({uid,children})=>React.createElement(Auth.Provider,{value:uid},children);
          export const useFirebaseAuth=()=>{const uid=React.useContext(Auth);const getToken=React.useCallback(async()=>uid,[uid]);return {user:{uid},getToken};};` };
        if (/components\/(member|team)$/.test(args.path)) return { contents: `export default function Roster(){return null;}` };
        return { contents: `export const getClientFirestore=()=>({});export const getFirebaseClientApp=()=>({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Fixture = {
  renderRoom: (reconnect?: boolean) => void;
  renderStandaloneStage: () => void;
  applySortingEdit: (order: string[], edit: { itemId: string; anchorId: string; placement: string }) => string[];
  roomTransport: {
    subscribe: (key: string, callback: (snapshot: unknown) => void) => () => void;
    snapshot: (key: string) => unknown;
    add: (key: string, data: Record<string, unknown>) => void;
    set: (key: string, data: Record<string, unknown>) => void;
    presentation: () => Record<string, unknown>;
    setPresentation: (round: string, question: string | null, withAnswer?: boolean) => void;
    holdAnswers: boolean;
    releaseAnswers: () => void;
    writes: Array<{ url: string; body: Record<string, unknown>; actor: string }>;
    reads: string[];
    mediaReads: string[];
    image: string;
  };
};

async function setup(page: Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const css = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__interactive-room", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${css.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body style="margin:0">${["first", "teammate", "host"].map((id) => `<section id="${id}" aria-label="${id} room"></section>`).join("")}</body></html>` }));
  await page.goto("/__interactive-room");
  await page.evaluate(() => {
    const w = window as unknown as Fixture;
    type Data = Record<string, unknown>;
    const docs: Record<string, Data> = {};
    const room = "rooms/demo", round = (id: string) => `${room}/rounds/${id}`;
    const answer = (id: string, question = "q1") => `${room}/teams/red/rounds/${id}/answers/${question}`;
    const rounds = [
      { id: "text", type: "text", title: "Capital cities", order: 0, state: "active", allowWager: true },
      { id: "sorting", type: "sorting", title: "Timeline", criterion: "Earliest to latest", order: 1, state: "active" },
      { id: "next", type: "text", title: "Foreground two", order: 2, state: "scheduled" },
      { id: "image", type: "image", title: "Flags", order: 3, state: "scheduled" },
      { id: "multi", type: "multi-step", title: "Clues", order: 4, state: "active", pointsPerStep: [2, 1], allowAnswerChanges: true },
      { id: "color", type: "color", title: "Colors", order: 5, state: "active" },
    ];
    for (const entry of rounds) docs[round(entry.id)] = entry;
    docs[`${round("text")}/questions/q1`] = { order: 0, text: "Capital of France?", stages: [{ text: "Capital of France?" }] };
    docs[`${round("next")}/questions/q1`] = { order: 0, text: "Foreground second question", stages: [{ text: "Foreground second question" }] };
    docs[`${round("text")}/answers/q1`] = { hint: "Paris", stages: [{ text: "Paris" }] };
    for (const id of ["a", "b", "c", "d"]) docs[`${round("sorting")}/questions/${id}`] = { text: id.toUpperCase() };
    docs[`${round("sorting")}/answers/order`] = { correctOrder: ["d", "c", "b", "a"] };
    docs[`${room}/teams/red/rounds/sorting`] = { order: ["a", "b", "c", "d"], revision: 0 };
    docs[`${round("multi")}/questions/q1`] = { order: 0, stages: [{ text: "Clue one" }, { text: "Clue two" }], finalizedStep: -1 };
    docs[`${round("color")}/questions/q1`] = { order: 0, initialColor: "#112233" };
    docs[`${round("image")}/questions/q1`] = { order: 0, text: "Country one" };
    docs[`${round("image")}/answers/q1`] = { answer: "flag1" };
    docs[`${round("image")}/images/flag1`] = { media: { storagePath: "flags/one.svg", filename: "one.svg", contentType: "image/svg+xml" } };
    let presenting: Data = { round: "text", question: "q1", withAnswer: false, promptPage: 0, answerPage: 0 };
    docs[room] = { state: "playing", presenting };
    const watchers = new Map<string, Set<(value: unknown) => void>>();
    const snapshot = (key: string): unknown => {
      const data = docs[key];
      const children = Object.keys(docs).filter((path) => path.startsWith(key + "/") && path.split("/").length === key.split("/").length + 1)
        .sort((a, b) => Number(docs[a].order ?? 0) - Number(docs[b].order ?? 0)).map((path) => snapshot(path));
      return { id: key.split("/").at(-1), ref: key, exists: () => data !== undefined,
        data: () => data ? { ...structuredClone(data), ...(data.createdAt ? { createdAt: { toDate: () => new Date("2026-11-07T12:00:00Z") } } : {}) } : undefined,
        docs: children, forEach: (callback: (value: unknown) => void) => children.forEach(callback),
        docChanges: () => children.map((doc) => ({ doc, type: "modified" })), metadata: { fromCache: false },
      };
    };
    const emit = (key: string) => {
      for (const path of [key, key.split("/").slice(0, -1).join("/")]) watchers.get(path)?.forEach((callback) => callback(snapshot(path)));
    };
    const set = (key: string, data: Data) => { docs[key] = { ...docs[key], ...data }; emit(key); };
    let messageId = 0;
    const held: Array<() => void> = [];
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="75"><rect width="150" height="75" fill="teal"/></svg>');
    w.roomTransport = {
      image, holdAnswers: false, writes: [], reads: [], mediaReads: [], snapshot, set,
      add: (key, data) => set(`${key}/message-${++messageId}`, data),
      subscribe: (key, callback) => {
        w.roomTransport.reads.push(key);
        if (!watchers.has(key)) watchers.set(key, new Set());
        watchers.get(key)!.add(callback);
        queueMicrotask(() => {
          if (!watchers.get(key)?.has(callback)) return;
          if (/rounds\/sorting\/(questions|answers)$/.test(key)) {
            callback({ id: key.split("/").at(-1), docs: [], forEach: () => {}, docChanges: () => [], metadata: { fromCache: true } });
          }
          callback(snapshot(key));
        });
        return () => watchers.get(key)!.delete(callback);
      },
      presentation: () => structuredClone(presenting),
      setPresentation: (id, question, withAnswer = false) => {
        presenting = { round: id, question, withAnswer, promptPage: 0, answerPage: 0 };
        if (id === "next") { set(round("text"), { state: "closed" }); set(round("next"), { state: "active" }); }
        docs[room].presenting = presenting;
        w.renderRoom();
      },
      releaseAnswers: () => { w.roomTransport.holdAnswers = false; held.splice(0).forEach((release) => release()); },
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = String(input);
      if (!url.startsWith("/api/rooms/demo/")) return originalFetch(input, options);
      const body = options?.body ? JSON.parse(options.body as string) as Data : {};
      const actor = new Headers(options?.headers).get("authorization")?.replace("Bearer ", "") ?? "unknown";
      w.roomTransport.writes.push({ url, body, actor });
      if (url.endsWith("/grade")) {
        set(round("image"), { gradingRequired: false });
        return new Response("{}", { status: 200 });
      }
      if (url.endsWith("/presenting")) {
        presenting = body.next as Data;
        docs[room].presenting = presenting;
        if (body.activateRound) set(round(body.activateRound as string), { state: "active" });
        if (body.closeRound) set(round(body.closeRound as string), { state: "closed" });
        w.renderRoom();
        return new Response("{}", { status: 200 });
      }
      if (url.endsWith("/rounds/sorting/answer")) {
        const key = `${room}/teams/red/rounds/sorting`;
        const current = docs[key];
        const edit = body.edit as { id: string; itemId: string; anchorId: string; placement: string };
        const revision = Number(current.revision) + 1;
        set(key, { order: w.applySortingEdit(current.order as string[], edit), revision });
        return new Response(JSON.stringify({ editId: edit.id, revision }), { status: 200 });
      }
      const match = url.match(/\/rounds\/([^/]+)\/answers\/([^/]+)$/);
      if (!match) throw new Error(`Unexpected room request: ${url}`);
      if (w.roomTransport.holdAnswers) await new Promise<void>((resolve) => held.push(resolve));
      const key = answer(match[1], match[2]);
      const mutation = { ...body };
      delete mutation.teamId; delete mutation.expectedStep;
      set(key, { answer: "", locked: false, wagered: false, user: actor, attempts: [], ...docs[key], ...mutation });
      return new Response(JSON.stringify(docs[key]), { status: 200 });
    };
  });
  await page.addScriptTag({ content: await bundle() });
  await expect(page.locator("#first").getByRole("button", { name: "Round 1: Capital cities", exact: true })).toBeVisible();
}

const room = (page: Page, id: string) => page.getByRole("region", { name: `${id} room`, exact: true });
const panel = (page: Page, id: string) => room(page, id).getByRole("region", { name: "Interactive panel", exact: true });
const view = (page: Page, id: string, name: string) => panel(page, id).getByRole("button", { name, exact: true });

for (const width of [1440, 390]) test(`two teammates retain answers, wagers, sorting and independent views at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const first = panel(page, "first"), teammate = panel(page, "teammate");
  await expect(first.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("button", { name: "Round 4: Flags", exact: true })).toHaveCount(0);
  await expect(first.getByRole("navigation", { name: "Chat channels" }).getByRole("button")).toHaveText(["All", "Team"]);
  await first.getByRole("button", { name: "Team", exact: true }).click();
  await first.getByRole("textbox", { name: "Message input" }).fill("Team-only message");
  await first.getByRole("textbox", { name: "Message input" }).press("Enter");
  await teammate.getByRole("button", { name: "Team", exact: true }).click();
  await expect(teammate.getByRole("log")).toContainText("Team-only message");
  await expect(first.getByRole("button", { name: "Team Blue", exact: true })).toHaveCount(0);
  await view(page, "first", "Round 1: Capital cities").click();
  await expect(teammate.getByRole("log")).toBeVisible();
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as Fixture).roomTransport.holdAnswers = true; });
  await first.getByRole("textbox", { name: "Answer 1", exact: true }).fill("P");
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.length)).toBe(1);
  await first.getByRole("textbox", { name: "Answer 1", exact: true }).fill("Paris");
  await view(page, "first", "Chat").click();
  await expect(first.getByRole("button", { name: "Team", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.releaseAnswers());
  await view(page, "teammate", "Round 1: Capital cities").click();
  await expect(teammate.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await view(page, "first", "Round 1: Capital cities").click();
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await first.getByRole("button", { name: "Double or nothing for answer 1" }).click();
  await expect(teammate.getByRole("button", { name: "Double or nothing for answer 1" })).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("button", { name: "Lock answer", exact: true }).click();
  await expect(teammate.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  await view(page, "first", "Round 2: Timeline").click();
  const handle = first.getByRole("button", { name: "Reorder item 1", exact: true });
  await expect(handle).toHaveAttribute("aria-disabled", "false");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.keyboard.press("ArrowDown");
  await expect(first.locator('[aria-live="assertive"]')).toHaveText("Over position 2.");
  await page.keyboard.press("Space");
  await expect.poll(() => first.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item-id")))).toEqual(["b", "a", "c", "d"]);
  await view(page, "first", "Chat").click();
  await view(page, "teammate", "Round 2: Timeline").click();
  await expect.poll(() => teammate.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item-id")))).toEqual(["b", "a", "c", "d"]);
  await view(page, "first", "Round 1: Capital cities").click();
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  await expect(first.getByRole("button", { name: "Double or nothing for answer 1" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter((write) => write.url.endsWith("/presenting")).length)).toBe(0);
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.setPresentation("next", "q1"));
  await view(page, "first", "Round 3: Foreground two").click();
  await expect(room(page, "first").getByRole("heading", { name: "Foreground second question" })).toBeVisible();
  await view(page, "first", "Round 2: Timeline").click();
  await expect(first.getByRole("list", { name: "Sorting order", exact: true })).toContainText("B");
  await view(page, "first", "Round 5: Clues").click();
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  await view(page, "first", "Round 6: Colors").click();
  await expect(first.getByText("#112233", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Fixture).renderRoom(true));
  await view(page, "first", "Round 2: Timeline").click();
  await expect.poll(() => first.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item-id")))).toEqual(["b", "a", "c", "d"]);
  await expect(first.getByRole("navigation", { name: "Interactive panel views" })).toHaveCount(1);
  await first.screenshot({ path: testInfo.outputPath(`interactive-player-${width}.png`), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("room integration preserves host channels, privately previews scheduled rounds, and reveals existing Stage answers", async ({ page }) => {
  await page.setViewportSize({ width: 1699, height: 888 });
  await setup(page);
  const host = panel(page, "host");
  await expect(host.getByRole("navigation", { name: "Chat channels" }).getByRole("button")).toHaveText(["All", "Team Red", "Team Blue"]);
  await expect(host.getByRole("alert")).toHaveCount(0);
  await host.getByRole("button", { name: "Team Red", exact: true }).click();
  await host.getByRole("textbox", { name: "Message input" }).fill("Host to red");
  await host.getByRole("textbox", { name: "Message input" }).press("Enter");
  await panel(page, "first").getByRole("button", { name: "Team", exact: true }).click();
  await expect(panel(page, "first").getByRole("log")).toContainText("Host to red");
  await view(page, "host", "Round 4: Flags").click();
  await expect(host.getByText("Country one", { exact: true })).toBeVisible();
  await expect.poll(() => host.getByRole("img", { name: "one.svg", exact: true }).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(150);
  await expect(host.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
  await expect(view(page, "host", "Round 4: Flags").getByRole("img", { name: "scheduled", exact: true })).toHaveCount(1);
  await host.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(host.getByRole("button", { name: "End round", exact: true })).toBeVisible();
  await host.getByRole("button", { name: "End round", exact: true }).click();
  await expect(host.getByRole("button", { name: "Show answers", exact: true })).toBeEnabled();
  await host.getByRole("button", { name: "Show answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toMatchObject({ round: "image", question: "q1", withAnswer: true });
  await view(page, "host", "Round 2: Timeline").click();
  await expect(host.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").first()).toHaveAttribute("data-item-id", "d");
  await view(page, "host", "Chat").click();
  await expect(host.getByRole("button", { name: "Team Red", exact: true })).toHaveAttribute("aria-pressed", "true");
});

for (const width of [1440, 390]) test(`host next-round activation lives in the Stage header at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  await page.evaluate(() => {
    const transport = (window as unknown as Fixture).roomTransport;
    for (const id of ["text", "multi", "color"]) transport.set(`rooms/demo/rounds/${id}`, { state: "closed", gradingRequired: false });
  });
  const hostRoom = room(page, "host");
  const header = hostRoom.locator("main > section > article > header").first();
  const message = header.getByText("Next up: Foreground two", { exact: true });
  await expect(message).toBeVisible();
  await expect(panel(page, "host").getByText("Next up: Foreground two", { exact: true })).toHaveCount(0);
  await expect(room(page, "first").getByText("Next up: Foreground two", { exact: true })).toHaveCount(0);
  await expect(message).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(message.locator("..")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const activate = header.getByRole("button", { name: "Next round", exact: true });
  await expect(activate).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const headerBounds = (await header.boundingBox())!, buttonBounds = (await activate.boundingBox())!;
  expect(headerBounds.x + headerBounds.width - buttonBounds.x - buttonBounds.width).toBeCloseTo(20, 0);
  await header.screenshot({ path: testInfo.outputPath(`next-round-header-${width}.png`), animations: "disabled" });
  await activate.click();
  await expect(message).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter((write) => write.body.activateRound === "next").length)).toBe(1);
  await expect(view(page, "host", "Round 2: Timeline").getByRole("img", { name: "active", exact: true })).toHaveCount(1);
});

test.describe("presentation scrollbar appearance", () => {
  for (const colorScheme of ["light", "dark"] as const) test(`presentation scrollbars stay consistent across question, grading, and sorting views in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const stage = room(page, "host").locator("main > section > article").first();
    const longText = Array.from({ length: 35 }, (_, index) => `Presentation line ${index + 1}: a long question or answer.`).join("\n") + "\n" + "WideContent".repeat(60);
    await page.evaluate((text) => {
      const transport = (window as unknown as Fixture).roomTransport;
      transport.set("rooms/demo/rounds/text/questions/q1", { text, stages: [{ text }] });
    }, longText);

    const scrollbars = () => stage.evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((element) => {
      const style = getComputedStyle(element);
      if (![style.overflowX, style.overflowY].some((overflow) => overflow === "auto" || overflow === "scroll")) return [];
      return [{
        width: style.scrollbarWidth,
        color: style.scrollbarColor,
        track: getComputedStyle(element, "::-webkit-scrollbar-track").backgroundColor,
        thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor,
        button: getComputedStyle(element, "::-webkit-scrollbar-button").display,
        barWidth: getComputedStyle(element, "::-webkit-scrollbar").width,
        barHeight: getComputedStyle(element, "::-webkit-scrollbar").height,
        corner: getComputedStyle(element, "::-webkit-scrollbar-corner").backgroundColor,
      }];
    }));
    await expect(stage.getByRole("heading", { name: /^Presentation line 1:/ })).toBeVisible();
    const normalScrollbars = await scrollbars();
    expect(normalScrollbars).toHaveLength(1);
    expect(normalScrollbars[0].width).toBe("thin");
    const expectedColor = normalScrollbars[0].color;
    async function verifyView(name: string) {
      const bars = await scrollbars();
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) {
        expect(bar.width, `${name}: scrollbar width`).toBe("thin");
        expect(bar.color, `${name}: scrollbar color`).toBe(expectedColor);
        expect(bar.track).toBe("rgba(0, 0, 0, 0)");
        expect(bar.thumb).toBe("rgba(255, 255, 255, 0.6)");
        expect(bar.button).toBe("none");
        expect(bar.barWidth).toBe("8px");
        expect(bar.barHeight).toBe("8px");
        expect(bar.corner).toBe("rgba(0, 0, 0, 0)");
      }
      expect(await stage.evaluate((root) => {
        const scrollport = Array.from(root.querySelectorAll<HTMLElement>("*")).find((element) => {
          const style = getComputedStyle(element);
          return ["auto", "scroll"].includes(style.overflowY) && element.clientHeight > 0 && element.scrollHeight > element.clientHeight;
        });
        if (!scrollport) return false;
        scrollport.scrollTop = 100;
        return scrollport.scrollTop > 0;
      }), `${name}: overflowing presentation remains scrollable`).toBe(true);
      if (name === "question") expect(await stage.evaluate((root) => {
        const horizontal = Array.from(root.querySelectorAll<HTMLElement>("*")).find((element) => {
          const style = getComputedStyle(element);
          return ["auto", "scroll"].includes(style.overflowX) && element.scrollWidth > element.clientWidth;
        });
        if (!horizontal) return false;
        horizontal.scrollLeft = 100;
        return horizontal.scrollLeft > 0;
      }), "wide question content remains horizontally scrollable").toBe(true);
      await stage.screenshot({ path: testInfo.outputPath(`presentation-${name}-${colorScheme}.png`), animations: "disabled" });
    }

    await page.evaluate(() => {
      const transport = (window as unknown as Fixture).roomTransport;
      for (let index = 0; index < 18; index++) {
        const id = `q${index + 1}`;
        transport.set(`rooms/demo/rounds/text/questions/${id}`, { order: index, text: `Question ${index + 1}`, stages: [{ text: `Question ${index + 1}` }] });
        transport.set(`rooms/demo/rounds/text/teamAnswers/red/answers/${id}`, { answer: `Answer ${index + 1}`, user: "first" });
      }
      transport.set("rooms/demo/rounds/text/teamAnswers/red", { graded: false });
      transport.set("rooms/demo/rounds/text", { state: "closed", gradingRequired: true });
      transport.setPresentation("text", null);
    });
    await expect(stage.getByRole("button", { name: "Finish grading", exact: true })).toBeVisible();
    await verifyView("grading");

    await page.evaluate((text) => {
      const transport = (window as unknown as Fixture).roomTransport;
      transport.set("rooms/demo/rounds/text/questions/q1", { text, stages: [{ text }] });
      transport.setPresentation("text", "q1");
    }, longText);
    await expect(stage.getByRole("heading", { name: /^Presentation line 1:/ })).toBeVisible();
    await verifyView("question");

    await page.evaluate(() => {
      const transport = (window as unknown as Fixture).roomTransport;
      const ids = ["a", "b", "c", "d", ...Array.from({ length: 20 }, (_, index) => `item-${index}`)];
      ids.forEach((id, index) => transport.set(`rooms/demo/rounds/sorting/questions/${id}`, { text: `Sorting item ${index + 1}${index === 0 ? " " + "WideSortingItem".repeat(40) : ""}` }));
      transport.set("rooms/demo/rounds/sorting/answers/order", { correctOrder: ids });
      transport.set("rooms/demo/teams/red/rounds/sorting", { order: ids, revision: 1 });
      transport.setPresentation("sorting", null);
    });
    await expect(stage.getByRole("heading", { name: "Earliest to latest", exact: true })).toBeVisible();
    await verifyView("sorting");
    await page.evaluate(() => {
      const transport = (window as unknown as Fixture).roomTransport;
      transport.set("rooms/demo/rounds/sorting", { state: "closed", gradingRequired: false });
      transport.setPresentation("sorting", null, true);
    });
    await expect(stage.getByRole("heading", { name: "Correct order", exact: true })).toBeVisible();
    await verifyView("sorting-reveal");
    await expect(panel(page, "host").getByRole("navigation", { name: "Interactive panel views", exact: true })).toHaveCSS("scrollbar-width", "none");
  });


  test("standalone presentation previews retain their scrollbar styling", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as unknown as Fixture).renderStandaloneStage());
    const preview = page.getByRole("region", { name: "Standalone presentation", exact: true });
    await expect(preview.getByRole("heading", { name: /^Preview line 0/ })).toBeVisible();
    const scrollport = preview.locator('div[class*="overflow-auto"]').first();
    await expect(scrollport).toHaveCSS("scrollbar-width", "thin");
    await expect(scrollport).toHaveCSS("scrollbar-color", "rgba(255, 255, 255, 0.6) rgba(0, 0, 0, 0)");
    expect(await scrollport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  });
});
