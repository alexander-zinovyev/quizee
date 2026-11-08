import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

// Keep native scrollbars visible for the presentation appearance regressions.
test.use({ colorScheme: "light", launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function bundle(withGate = false) {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import RoomContent from './app/[room]/room-content';
      ${withGate ? "import RoomGate from './app/[room]/room-gate';" : ""}
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
            ${withGate ? '<RoomGate roomSlug="demo"/>' : `<RoomContent roomSlug="demo" teams={teams} hostMember={{id:'host',name:'Host'}}
              isHost={uid==='host'} viewerTeamId={uid==='host'?null:'red'} viewerName={names[uid]}
              memberNames={names} presenting={window.roomTransport.presentation()}/>`}
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
    bundle: true, write: false, jsx: "automatic", loader: { ".css": "empty" },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "room-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/media$/ }, (args) => ({ path: args.path, namespace: "room-mock" }));
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider|@\/lib\/components\/(member|team))$/ }, (args) => ({ path: args.path, namespace: "room-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "room-mock" }, (args) => {
        if (args.path === "@/lib/media") return { contents: `export const createMediaTransport=()=>({
          onParticipantUpdate:()=>()=>{},onError:()=>()=>{},join:async()=>{},leave:async()=>{},setSubscriptionPolicy:async()=>{},
        });` };
        if (args.path === "firebase/firestore") return { contents: `
          const path=(base,...parts)=>[...(typeof base==='string'?[base]:[]),...parts].join('/');
          export const doc=path;export const collection=path;export const query=value=>value;export const orderBy=()=>null;export const where=()=>null;
          export const onSnapshot=(key,options,callback)=>window.roomTransport.subscribe(key,typeof options==='function'?options:callback);
          export const getDoc=async key=>window.roomTransport.snapshot(key);
          export const getDocFromServer=getDoc;export const getDocs=getDoc;
          export const serverTimestamp=()=>({fixtureTimestamp:true});
          export const Timestamp={fromDate:date=>date};
          export const addDoc=async(key,data)=>window.roomTransport.add(key,data);
          export const setDoc=async(key,data)=>window.roomTransport.set(key,data);
          export const updateDoc=setDoc;
          export const writeBatch=()=>{const writes=[];return {set:(key,data)=>writes.push([key,data]),commit:async()=>{writes.forEach(([key,data])=>window.roomTransport.set(key,data));}};};
          export const runTransaction=()=>{throw new Error('Image matching is covered in image-matching.spec.ts');};
        ` };
        if (args.path === "firebase/storage") return { contents: `
          export const getStorage=()=>({});export const ref=(_,path)=>path;
          export const getDownloadURL=async path=>{window.roomTransport.mediaReads.push(path);return window.roomTransport.image;};` };
        if (args.path.includes("firebase-auth-provider")) return { resolveDir: process.cwd(), contents: `
          import React from 'react';const Auth=React.createContext('unknown');
          export const HarnessAuthProvider=({uid,children})=>React.createElement(Auth.Provider,{value:uid},children);
          export const useFirebaseAuth=()=>{const uid=React.useContext(Auth);const user=React.useMemo(()=>({uid}),[uid]);const getToken=React.useCallback(async()=>uid,[uid]);return {user,loading:false,getToken};};` };
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
    holdGrading: boolean;
    releaseGrading: () => void;
    gradingError?: string;
    writes: Array<{ url: string; body: Record<string, unknown>; actor: string }>;
    reads: string[];
    mediaReads: string[];
    image: string;
  };
};

async function setup(page: Page, withGate = false) {
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
    docs[`${room}/teams/red`] = { name: "Team Red", scoreTotal: 10 };
    docs[`${room}/teams/blue`] = { name: "Team Blue", scoreTotal: 5 };
    for (const uid of ["first", "teammate", "host"]) docs[`${room}/members/${uid}`] = {
      name: uid, role: uid === "host" ? "host" : "player", team: uid === "host" ? null : "red",
    };
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
    const heldGrades: Array<() => void> = [];
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="75"><rect width="150" height="75" fill="teal"/></svg>');
    w.roomTransport = {
      image, holdAnswers: false, holdGrading: false, writes: [], reads: [], mediaReads: [], snapshot, set,
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
      releaseGrading: () => { w.roomTransport.holdGrading = false; heldGrades.splice(0).forEach((release) => release()); },
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = String(input);
      if (!url.startsWith("/api/rooms/demo/")) return originalFetch(input, options);
      const body = options?.body ? JSON.parse(options.body as string) as Data : {};
      const actor = new Headers(options?.headers).get("authorization")?.replace("Bearer ", "") ?? "unknown";
      w.roomTransport.writes.push({ url, body, actor });
      if (url.endsWith("/grade")) {
        if (w.roomTransport.holdGrading) await new Promise<void>((resolve) => heldGrades.push(resolve));
        if (w.roomTransport.gradingError) return new Response(JSON.stringify({ message: w.roomTransport.gradingError }), { status: 500 });
        const id = url.split("/").at(-2)!;
        set(round(id), { gradingRequired: false });
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
  await page.addScriptTag({ content: await bundle(withGate) });
  await expect(page.locator("#first").getByRole("button", { name: "Round 1: Capital cities", exact: true })).toBeVisible();
}

const room = (page: Page, id: string) => page.getByRole("region", { name: `${id} room`, exact: true });
const panel = (page: Page, id: string) => room(page, id).getByRole("region", { name: "Interactive panel", exact: true });
const view = (page: Page, id: string, name: string) => panel(page, id).getByRole("button", { name, exact: true });

const floating = (page: Page, title: string) => page.getByRole("dialog", { name: `${title} window`, exact: true });

async function moveWindow(page: Page, floatingWindow: Locator, x: number, y: number, touch = false) {
  const handle = floatingWindow.getByRole("button", { name: /^Move / });
  const grip = (await handle.boundingBox())!, bounds = (await floatingWindow.boundingBox())!;
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const end = { x: start.x + x - bounds.x, y: start.y + y - bounds.y };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await client.detach(); }
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
  }
}

for (const width of [1440, 390]) test(`floating tabs preserve live work and independent layouts at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const first = panel(page, "first"), teammate = panel(page, "teammate");
  const presentation = await page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation());
  await first.getByRole("textbox", { name: "Message input" }).fill("Unsent draft");
  await first.getByRole("button", { name: "Open Chat in window", exact: true }).click();
  const chat = floating(page, "Chat");
  await expect(first.getByText("This tab is open in a window.", { exact: true })).toBeVisible();
  await expect(chat.getByRole("textbox", { name: "Message input" })).toHaveValue("Unsent draft");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(teammate.getByRole("textbox", { name: "Message input" })).toBeVisible();
  await moveWindow(page, chat, 8, 480, width === 390);
  const bounds = (await chat.boundingBox())!;
  expect(bounds.x).toBeCloseTo(8, 0);
  expect(bounds.y).toBeGreaterThan(400);
  await view(page, "first", "Round 1: Capital cities").click();
  await first.getByRole("textbox", { name: "Answer 1", exact: true }).fill("Paris");
  await first.getByRole("button", { name: "Lock answer", exact: true }).click();
  await chat.getByRole("textbox", { name: "Message input" }).press("Enter");
  await expect(teammate.getByRole("log")).toContainText("Unsent draft");
  await expect(teammate.getByRole("log").getByText("Unsent draft", { exact: true })).toHaveCount(1);
  await chat.getByRole("textbox", { name: "Message input" }).fill("Keep across replacement");
  await first.getByRole("button", { name: "Open Round 1: Capital cities in window", exact: true }).click();
  const answer = floating(page, "Round 1: Capital cities");
  await expect(chat).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(answer.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await expect(answer.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  await moveWindow(page, answer, 8, 480);
  await view(page, "first", "Chat").click();
  await expect(first.getByRole("textbox", { name: "Message input" })).toHaveValue("Keep across replacement");
  await answer.getByRole("button", { name: "Close window", exact: true }).click();
  await expect(view(page, "first", "Round 1: Capital cities")).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await expect(first.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter(write => write.body.locked === true))).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toEqual(presentation);
  await expect(view(page, "teammate", "Chat")).toHaveAttribute("aria-pressed", "true");
  await expect(view(page, "host", "Chat")).toHaveAttribute("aria-pressed", "true");
  await teammate.getByRole("button", { name: "Open Chat in window", exact: true }).click();
  const teammateChat = floating(page, "Chat");
  await moveWindow(page, teammateChat, 8, 480);
  const teammatePlacement = await teammateChat.boundingBox();
  await first.getByRole("button", { name: "Open Round 1: Capital cities in window", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await moveWindow(page, floating(page, "Round 1: Capital cities"), 8, 8);
  expect(await teammateChat.boundingBox()).toEqual(teammatePlacement);
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toEqual(presentation);
});

for (const width of [1440, 390]) test(`floating sorting keeps item dragging separate and close reachable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  await view(page, "first", "Round 2: Timeline").click();
  await panel(page, "first").getByRole("button", { name: "Open Round 2: Timeline in window", exact: true }).click();
  const floatingWindow = floating(page, "Round 2: Timeline");
  await floatingWindow.screenshot({ path: testInfo.outputPath(`floating-sorting-${width}.png`) });
  const bounds = (await floatingWindow.boundingBox())!;
  const source = (await floatingWindow.getByRole("button", { name: "Reorder item 1", exact: true }).boundingBox())!;
  const target = (await floatingWindow.locator('[data-item-id="b"]').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2, { steps: 10 });
  await expect(floatingWindow.getByRole("button", { name: "Reorder item 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter(write => write.url.endsWith("/sorting/answer")).length)).toBe(1);
  expect(await floatingWindow.boundingBox()).toEqual(bounds);
  await expect.poll(() => floatingWindow.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").evaluateAll(rows => rows.map(row => row.getAttribute("data-item-id")))).toEqual(["b", "a", "c", "d"]);
  const grip = floatingWindow.getByRole("button", { name: "Move Round 2: Timeline window", exact: true });
  const viewportWidth = await page.evaluate(() => window.visualViewport?.width ?? window.innerWidth);
  await grip.press("ArrowRight");
  expect((await floatingWindow.boundingBox())!.x).toBeCloseTo(Math.min(bounds.x + 16, viewportWidth - bounds.width - 8), 0);
  await grip.press("ArrowDown");
  expect((await floatingWindow.boundingBox())!.y).toBeCloseTo(bounds.y + 16, 0);
  await moveWindow(page, floatingWindow, 5000, 5000);
  await expect(floatingWindow.getByRole("button", { name: "Close window", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 500 });
  await expect(floatingWindow.getByRole("button", { name: "Close window", exact: true })).toBeInViewport();
  await floatingWindow.getByRole("button", { name: "Close window", exact: true }).click();
  await expect(panel(page, "first").getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").first()).toHaveAttribute("data-item-id", "b");
});

test("moving a text round preserves its in-flight answer queue and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const first = panel(page, "first");
  await view(page, "first", "Round 1: Capital cities").click();
  await page.evaluate(() => { (window as unknown as Fixture).roomTransport.holdAnswers = true; });
  const input = first.getByRole("textbox", { name: "Answer 1", exact: true });
  const originalInput = await input.elementHandle();
  await input.fill("P");
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.length)).toBe(1);
  await input.fill("Paris");
  await first.getByRole("button", { name: "Open Round 1: Capital cities in window", exact: true }).click();
  await expect(floating(page, "Round 1: Capital cities").getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  await first.getByRole("button", { name: "Return to panel", exact: true }).click();
  await expect(input).toHaveValue("Paris");
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  await expect(first.getByRole("button", { name: "Open Round 1: Capital cities in window", exact: true })).toBeFocused();
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.releaseAnswers());
  await view(page, "teammate", "Round 1: Capital cities").click();
  await expect(panel(page, "teammate").getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.map(write => write.body.answer))).toEqual(["P", "Paris"]);
});

test("players can float each round type available to them", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.set("rooms/demo/rounds/image", { state: "active" }));
  const first = panel(page, "first");
  for (const title of ["Round 1: Capital cities", "Round 2: Timeline", "Round 4: Flags", "Round 5: Clues", "Round 6: Colors"]) {
    await view(page, "first", title).click();
    const roundName = title.split(": ")[1];
    const originalContent = await first.getByRole("region", { name: roundName, exact: true }).elementHandle();
    await first.getByRole("button", { name: `Open ${title} in window`, exact: true }).click();
    await expect(floating(page, title)).toBeVisible();
    await expect(floating(page, title).getByRole("region", { name: roundName, exact: true })).toBeVisible();
    await expect(first.getByRole("region", { name: roundName, exact: true })).toHaveCount(0);
    expect(await originalContent!.evaluate(element => element.isConnected)).toBe(true);
    await floating(page, title).getByRole("button", { name: "Close window", exact: true }).click();
    await expect(first.getByRole("region", { name: roundName, exact: true })).toBeVisible();
    expect(await originalContent!.evaluate(element => element.isConnected)).toBe(true);
  }
});

for (const width of [1440, 390]) test(`host can float every tab and use live round controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const host = panel(page, "host");
  for (const title of ["Chat", "Round 1: Capital cities", "Round 2: Timeline", "Round 3: Foreground two", "Round 4: Flags", "Round 5: Clues", "Round 6: Colors"]) {
    await view(page, "host", title).click();
    await host.getByRole("button", { name: `Open ${title} in window`, exact: true }).click();
    await expect(floating(page, title)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await floating(page, title).getByRole("button", { name: "Close window", exact: true }).click();
    await expect(view(page, "host", title)).toHaveAttribute("aria-pressed", "true");
  }
  await view(page, "host", "Round 4: Flags").click();
  await host.getByRole("button", { name: "Open Round 4: Flags in window", exact: true }).click();
  const floatingWindow = floating(page, "Round 4: Flags");
  await floatingWindow.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(floatingWindow.getByRole("button", { name: "End round", exact: true })).toBeVisible();
  await floatingWindow.getByRole("button", { name: "Close window", exact: true }).click();
  await expect(host.getByRole("button", { name: "End round", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter(write => write.body.activateRound === "image"))).toHaveLength(1);
});

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

for (const hidden of [false, true]) test(`ending a color round clears the player's stage when its question is ${hidden ? "hidden" : "visible"}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.evaluate(() => {
    const transport = (window as unknown as Fixture).roomTransport;
    for (const [index, id] of ["q1", "q2"].entries()) {
      transport.set(`rooms/demo/rounds/color/questions/${id}`, {
        order: index, initialColor: "#112233",
        media: { storagePath: "colors/image.svg" }, mask: { storagePath: "colors/mask.svg" },
      });
      transport.set(`rooms/demo/rounds/color/answers/${id}`, { answer: "#445566" });
      for (const team of ["red", "blue"]) transport.set(`rooms/demo/rounds/color/teamAnswers/${team}/answers/${id}`, {
        answer: "#112233", perceptionScore: 8, awardedPoints: 1,
      });
    }
    transport.holdGrading = true;
  });
  const host = panel(page, "host");
  const playerStage = room(page, "first").locator("main > section > article").first();
  const stageContent = playerStage.locator(":scope > div").first();
  await view(page, "host", "Round 6: Colors").click();
  await host.getByRole("button", { name: "Show question 2", exact: true }).click();
  await expect(playerStage.getByRole("img", { name: "Color question", exact: true })).toBeVisible();
  await expect(playerStage.getByRole("button", { name: "Lock answer", exact: true })).toBeEnabled();
  if (hidden) {
    await host.getByRole("button", { name: "Hide question 2", exact: true }).click();
    await expect(stageContent.getByText("Colors", { exact: true })).toBeVisible();
  }
  await host.getByRole("button", { name: "End round", exact: true }).click();
  const cleared = { round: "color", question: null, withAnswer: false, promptPage: 0, answerPage: 0 };
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toEqual(cleared);
  await expect(stageContent.getByText("Colors", { exact: true })).toBeVisible();
  await expect(playerStage.getByRole("img")).toHaveCount(0);
  await expect(playerStage.getByRole("button", { name: "Lock answer", exact: true })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Show answers", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.releaseGrading());
  await expect(host.getByRole("button", { name: "Show answers", exact: true })).toBeEnabled();
  await expect(stageContent.getByText("Colors", { exact: true })).toBeVisible();
  await expect(playerStage.getByRole("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter((write) => write.body.closeRound === "color"))).toEqual([
    { url: "/api/rooms/demo/presenting", actor: "host", body: {
      expected: { ...cleared, question: hidden ? null : "q2" }, next: cleared, closeRound: "color",
    } },
  ]);
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.writes.filter((write) => write.url.endsWith("/color/grade")).length)).toBe(1);
  await host.getByRole("button", { name: "Show answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toEqual({ ...cleared, question: "q1", withAnswer: true });
  await expect(playerStage.getByRole("region", { name: "Your submission", exact: true }).getByRole("img", { name: "Correct answer", exact: true })).toBeVisible();
  await expect(playerStage.getByLabel("Question score", { exact: true })).toContainText("Similarity 8.00 / 10");
  await expect(playerStage.getByRole("button", { name: "Lock answer", exact: true })).toHaveCount(0);
});

test("ending a color round preserves another round's presentation", async ({ page }) => {
  await setup(page);
  const before = await page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation());
  await view(page, "host", "Round 6: Colors").click();
  await panel(page, "host").getByRole("button", { name: "End round", exact: true }).click();
  await expect(panel(page, "host").getByRole("button", { name: "Show answers", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toEqual(before);
  await expect(room(page, "first").locator("main > section > article").first().getByText("Capital of France?", { exact: true })).toBeVisible();
});

for (const type of ["text", "multi"] as const) test(`host opens grading for a selected ${type} round and reveals answers after finishing`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate((type) => {
    const transport = (window as unknown as Fixture).roomTransport;
    transport.set(`rooms/demo/rounds/${type}`, { state: "closed", gradingRequired: true });
    transport.set(`rooms/demo/rounds/${type}/teamAnswers/red`, { graded: false });
    transport.set(`rooms/demo/rounds/${type}/teamAnswers/red/answers/q1`, type === "multi"
      ? { attempts: [{ answer: "Submitted answer", step: 0, submittedBy: "first", submittedAt: null }] }
      : { answer: "Submitted answer" });
    if (type === "multi") transport.set("rooms/demo/rounds/multi/answers/q1", { hint: "Paris", stages: [{ text: "Paris" }] });
    transport.setPresentation("sorting", null);
  }, type);
  const roundName = type === "text" ? "Round 1: Capital cities" : "Round 5: Clues";
  await view(page, "host", roundName).click();
  const host = panel(page, "host");
  const stage = room(page, "host").locator("main > section > article").first();
  await host.locator("header").getByRole("button", { name: "Grade answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toMatchObject({ round: type, question: null, withAnswer: false });
  await expect(stage.getByText("Submitted answer", { exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "Show answers", exact: true })).toHaveCount(0);
  await stage.getByRole("spinbutton").fill("1");
  await stage.getByRole("button", { name: "Finish grading", exact: true }).click();
  await expect(host.getByRole("button", { name: "Grade answers", exact: true })).toHaveCount(0);
  await host.getByRole("button", { name: "Show answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toMatchObject({ round: type, question: "q1", withAnswer: true });
  await expect(stage.getByText("Paris", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: "Hide answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toMatchObject({ round: type, question: "q1", withAnswer: false });
  await expect(stage.getByRole("button", { name: "Finish grading", exact: true })).toHaveCount(0);
  await expect(panel(page, "first").getByRole("button", { name: "Grade answers", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const type of ["image", "sorting", "color"] as const) test(`${type} grading keeps its header action on failure and switches to reveal after a successful retry`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.evaluate((type) => {
    const transport = (window as unknown as Fixture).roomTransport;
    transport.set(`rooms/demo/rounds/${type}`, { state: "closed", gradingRequired: true });
    transport.gradingError = "Scoring unavailable";
  }, type);
  await view(page, "host", { image: "Round 4: Flags", sorting: "Round 2: Timeline", color: "Round 6: Colors" }[type]).click();
  const host = panel(page, "host"), grade = host.locator("header").getByRole("button", { name: "Grade answers", exact: true });
  await grade.click();
  await expect(host.getByRole("alert")).toContainText("Scoring unavailable");
  await expect(grade).toBeEnabled();
  await expect(host.getByRole("button", { name: "Show answers", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const transport = (window as unknown as Fixture).roomTransport;
    transport.gradingError = undefined;
    transport.holdGrading = true;
  });
  await grade.click();
  await expect(grade).toBeDisabled();
  await page.evaluate(() => (window as unknown as Fixture).roomTransport.releaseGrading());
  await expect(grade).toHaveCount(0);
  await host.getByRole("button", { name: "Show answers", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).roomTransport.presentation())).toMatchObject({ round: type, question: type === "sorting" ? null : "q1", withAnswer: true });
  await expect(host.getByRole("alert")).toHaveCount(0);
});

for (const width of [1440, 390]) test(`host next-round activation lives in the Stage header at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const hostRoom = room(page, "host");
  const header = hostRoom.locator("main > section > article > header").first();
  await expect(header.getByRole("button", { name: "Next round", exact: true })).toHaveCount(0);
  await expect(header.getByText(/^Next up:/)).toHaveCount(0);
  await page.evaluate(() => {
    const transport = (window as unknown as Fixture).roomTransport;
    for (const id of ["text", "multi", "color"]) transport.set(`rooms/demo/rounds/${id}`, { state: "closed", gradingRequired: false });
  });
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

for (const width of [1440, 390]) test(`host end-game action lives in the Stage header at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page, true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const hostRoom = room(page, "host");
  const header = hostRoom.locator("main > section > article > header").first();
  const endGame = header.getByRole("button", { name: "End game", exact: true });
  await page.evaluate(() => {
    const transport = (window as unknown as Fixture).roomTransport;
    for (const id of ["text", "next", "image", "multi", "color"]) transport.set(`rooms/demo/rounds/${id}`, { state: "closed", gradingRequired: false });
  });
  // Sorting stays open in the background after every foreground round has closed.
  await expect(view(page, "host", "Round 2: Timeline").getByRole("img", { name: "active", exact: true })).toHaveCount(1);
  await expect(hostRoom.getByRole("button", { name: "End game", exact: true })).toHaveCount(0);
  await expect(hostRoom.getByText("All rounds closed.", { exact: true })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Next round", exact: true })).toHaveCount(0);
  await view(page, "host", "Round 2: Timeline").click();
  await panel(page, "host").getByRole("button", { name: "End round", exact: true }).click();

  const notice = header.getByText("All rounds closed.", { exact: true });
  for (const selected of ["Round 2: Timeline", "Chat", "Round 1: Capital cities"]) {
    await view(page, "host", selected).click();
    await expect(notice).toBeVisible();
    await expect(endGame).toBeVisible();
    await expect(hostRoom.getByRole("button", { name: "End game", exact: true })).toHaveCount(1);
    await expect(hostRoom.getByText("All rounds closed.", { exact: true })).toHaveCount(1);
    await expect(panel(page, "host").getByRole("button", { name: "End game", exact: true })).toHaveCount(0);
    await expect(panel(page, "host").getByText("All rounds closed.", { exact: true })).toHaveCount(0);
  }
  await expect(header.getByText(/^Next up:/)).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Next round", exact: true })).toHaveCount(0);
  for (const id of ["first", "teammate"]) {
    await expect(room(page, id).getByRole("button", { name: "End game", exact: true })).toHaveCount(0);
    await expect(room(page, id).getByText("All rounds closed.", { exact: true })).toHaveCount(0);
  }
  const headerBounds = (await header.boundingBox())!, buttonBounds = (await endGame.boundingBox())!;
  expect(headerBounds.x + headerBounds.width - buttonBounds.x - buttonBounds.width).toBeCloseTo(20, 0);
  const noticeBounds = (await notice.boundingBox())!;
  expect(Math.abs(noticeBounds.y + noticeBounds.height / 2 - buttonBounds.y - buttonBounds.height / 2)).toBeLessThan(1);
  expect(await hostRoom.evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true);
  await header.screenshot({ path: testInfo.outputPath(`end-game-header-${width}.png`), animations: "disabled" });
  await view(page, "host", width === 1440 ? "Chat" : "Round 1: Capital cities").click();
  await endGame.click();
  expect(await page.evaluate(() => {
    const snapshot = (window as unknown as Fixture).roomTransport.snapshot("rooms/demo") as { data: () => Record<string, unknown> };
    return snapshot.data();
  })).toMatchObject({
    state: "ended", presenting: { round: null, question: null, withAnswer: false, promptPage: 0, answerPage: 0 },
  });
  for (const id of ["host", "first", "teammate"]) {
    await expect(room(page, id).getByText("Quiz ended", { exact: true })).toBeVisible();
    await expect(room(page, id).getByText("Final standings and recaps appear here. Teams and players remain visible for debrief.", { exact: true })).toBeVisible();
    await expect(panel(page, id)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
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
