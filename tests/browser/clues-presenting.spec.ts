import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import type { CluesView } from "../../types/clues";
type Fixture = CluesView & { questionId?: string };
async function seed(page: import("@playwright/test").Page, view: Fixture) {
  await page.addInitScript((value) => { (window as unknown as { clueState: Fixture }).clueState = value; }, view);
  await page.route("**/api/rooms/demo/rounds/*/answers/*/clues", (route) => route.fulfill({ status: 500, json: { message: "Content must come from Firestore" } }));
}
async function publish(page: import("@playwright/test").Page, view?: Fixture, fail = false) {
  await page.evaluate(({ view, fail }) => {
    const fixture = window as unknown as { clueState: Fixture; emitClues: (fail: boolean) => void };
    if (view) fixture.clueState = view;
    fixture.emitClues(fail);
  }, { view, fail });
}
const hint = { id: "hint", category: "History", price: 2 };
const hidden: Fixture = { teamId: "red", remainingCoins: 5, clues: [{ ...hint, purchased: false }] };
const bought: Fixture = { teamId: "red", remainingCoins: 3, clues: [{ ...hint, purchased: true, content: { text: "A capital" } }] };


async function setup(page: import("@playwright/test").Page, mode: "standard" | "live" | "media" | "playback" | "live-media" = "standard", mediaKind: "audio" | "video" = "audio") {
  await page.goto("/build");
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__clues-view", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main></main></body></html>` }));
  await page.goto("/__clues-view");
  if (["playback", "live-media", "media"].includes(mode)) await page.evaluate((source) => {
    (window as unknown as { playbackSource: string }).playbackSource = source;
  }, `data:audio/wav;base64,${silentWave().toString("base64")}`);
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CluesQuestionView,CluesPresenting} from './lib/components/clues-presenting';
    function LiveHarness(){const [generation,setGeneration]=useState(0);return <><button onClick={()=>setGeneration(generation+1)}>Reconnect</button><CluesPresenting key={generation} roomSlug="demo" round={{id:'r1',title:'Clues',type:'clues',state:'active',order:0,startingCoins:5}} question={{clues:window.clueState.clues,id:'q1',prompt:'Name the place',displayPrompt:'Name the place',order:0}} teamId="red" isHost={false} revealedClueIds={[]} pending={false} onReveal={()=>{}}/></>;}

    function PlaybackHarness(){const [answer,setAnswer]=useState(null);return <>
      <button onClick={()=>setAnswer({text:'Paris',media:{filename:'answer.${mediaKind === "audio" ? "wav" : "webm"}',url:window.playbackSource}})}>Reveal media answer</button>
      <button onClick={()=>setAnswer({text:'Paris'})}>Reveal text answer</button>
      <button onClick={()=>setAnswer(null)}>Hide answer</button>
      <CluesQuestionView generalClue={{text:'Name the place',media:{filename:'general.${mediaKind === "audio" ? "wav" : "webm"}',url:window.playbackSource}}}
        answer={answer} startingCoins={5} view={{teamId:'red',remainingCoins:5,clues:[]}} isHost={false} closed={true} revealedClueIds={[]} pending={false} onReveal={()=>{}} onPurchase={()=>{}}/>
    </>;}
    function LiveMediaHarness(){const [question,setQuestion]=useState('q1'),[team,setTeam]=useState('red'),[revealed,setRevealed]=useState([]),[closed,setClosed]=useState(false);return <>
      <button onClick={()=>setQuestion('q2')}>Change question</button><button onClick={()=>setTeam('blue')}>Change viewer</button>
      <button onClick={()=>{setClosed(true);setRevealed(window.clueState.clues.filter(clue=>!clue.purchased).map(clue=>clue.id));}}>Show public clues</button><button onClick={()=>setRevealed([])}>Hide public clues</button>
      <CluesPresenting roomSlug="demo" round={{id:'r1',title:'Clues',type:'clues',state:closed?'closed':'active',order:0,startingCoins:5}}
        question={{clues:window.clueState.clues,id:question,prompt:'Name the place',displayPrompt:'Name the place',order:0}} teamId={team} isHost={false}
        generalMedia={{filename:'general.${mediaKind === "audio" ? "wav" : "webm"}',url:window.playbackSource}} revealedClueIds={revealed} pending={false} onReveal={setRevealed}/>
    </>;}
    function MediaHarness(){return <CluesQuestionView generalClue={{media:{filename:'general.wav',url:window.playbackSource}}} answer={{media:{filename:'answer.webm',url:'/test/answer.webm'}}}
      startingCoins={16} isHost={true} closed={false} revealedClueIds={[]} pending={false} onReveal={()=>{}} onPurchase={()=>{}}
      mediaUrls={{audio:'/test/clue.mp3',video:'/test/clue.webm'}} view={{teamId:'red',remainingCoins:16,clues:[
        {id:'audio',category:'Audio',price:1,purchased:true,content:{media:{filename:'clue.mp3'}}},
        {id:'video',category:'Video',price:1,purchased:true,content:{text:'A clip',media:{filename:'clue.webm'}}},
      ]}}/>;}
    function Harness(){
      const [host,setHost]=useState(true),[closed,setClosed]=useState(false),[revealed,setRevealed]=useState([]),[purchased,setPurchased]=useState([]),[coins,setCoins]=useState(5);
      const clues=[{id:'history',category:'History',price:2,text:'A capital'}, {id:'photo',category:'Photo',price:3,text:'The skyline',image:true}];
      return <><button onClick={()=>setHost(!host)}>{host?'View as player':'View as host'}</button><button onClick={()=>setClosed(true)}>Close round</button><button onClick={()=>setRevealed([])}>Change question</button>
        <section className="w-[850px] max-w-full bg-black"><CluesQuestionView generalClue={{text:"Name the place"}} startingCoins={5} isHost={host} closed={closed} revealedClueIds={revealed} pending={false}
          mediaUrls={{photo:'/clues/coins.svg'}} view={{teamId:'red',remainingCoins:coins,clues:clues.map(clue=>{const visible=host||purchased.includes(clue.id)||revealed.includes(clue.id);return {id:clue.id,category:clue.category,price:clue.price,purchased:purchased.includes(clue.id),...(visible?{content:{text:clue.text,...(clue.image?{media:{filename:"photo.png"}}:{})}}:{})};})}}
          onReveal={setRevealed} onPurchase={id=>{const price=clues.find(clue=>clue.id===id).price;if(price<=coins){setPurchased([...purchased,id]);setCoins(coins-price);}}}/></section></>;
    }createRoot(document.querySelector('main')).render(${mode === 'live' ? '<LiveHarness/>' : mode === 'media' ? '<MediaHarness/>' : mode === 'playback' ? '<PlaybackHarness/>' : mode === 'live-media' ? '<LiveMediaHarness/>' : '<Harness/>'});`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "clues-transport", setup(builder) {
      builder.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: "firebase/storage", namespace: "clues-storage" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-storage" }, () => ({ contents: "export const getStorage=()=>({});export const ref=(_,path)=>path;export const getDownloadURL=async path=>'/test-storage/'+path;" }));
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firebase/firestore", namespace: "clues-firestore" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-firestore" }, () => ({ contents: `
        export const doc=(_, ...parts)=>({path:parts.join('/')});
        export const collection=doc;
        export const where=(_,__,questionId)=>questionId;
        export const query=(ref,questionId)=>({...ref,questionId});
        const listeners=new Set();
        function emit(listener,fail=false){
          const {ref,callback,error}=listener,view=window.clueState;
          if(fail){error(new Error('Clue subscription failed'));return;}
          const parts=ref.path.split('/'),team=parts[3];
          const item=(id,data)=>({id,data:()=>data,exists:()=>!!data});
          if(parts.at(-1)==='openedClues'){
            const opened=team===view.teamId && ref.questionId===(view.questionId??'q1') ? view.clues.filter(clue=>clue.purchased) : [];
            callback({docs:opened.map(clue=>item(clue.id,{clueId:clue.id,questionId:ref.questionId,content:clue.content}))});
          }else if(parts.includes('cluePurchases')) callback(item('r1',team===view.teamId?{remainingCoins:view.remainingCoins}:null));
          else callback(item(parts.at(-1),{content:view.clues.find(clue=>clue.id===parts.at(-1))?.content}));
        }
        window.emitClues=(fail=false)=>{for(const listener of listeners)emit(listener,fail);};
        export const onSnapshot=(ref,callback,error)=>{const listener={ref,callback,error};listeners.add(listener);emit(listener);return ()=>listeners.delete(listener);};
      ` }));
      builder.onResolve({ filter: /^(@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "clues-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-mock" }, (args) => ({ contents: args.path.includes("firebase-auth") ? "const getToken=async()=>'';export const useFirebaseAuth=()=>({getToken});" : "export const getClientFirestore=()=>({});export const getFirebaseClientApp=()=>({});" }));
    } }],
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole("heading", { name: mode === "media" ? "Clues" : "Name the place", exact: true })).toBeVisible();
}
test("host sees all active clues; closed-round all/individual controls preserve team purchases", async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.locator('img[src="/clues/coins.svg"][width="21"]')).toHaveCount(3);
  await expect.poll(() => page.locator('img[src="/clues/coins.svg"][width="21"]').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth === 21 && image.getBoundingClientRect().width === 21 && image.getBoundingClientRect().height === 16))).toBe(true);
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  await expect(page.getByText("The skyline", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all clues", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "View as player" }).click();
  await expect(page.getByText("Clue hidden", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Open for 2", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toBeVisible();
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open for 3", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(2);
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close round" }).click();
  await page.getByRole("button", { name: "View as host" }).click();
  await page.getByRole("button", { name: "Show Photo clue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide Photo clue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show all clues", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide History clue", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide all clues", exact: true }).click();
  await page.getByRole("button", { name: "View as player" }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Open for/ })).toHaveCount(0);
  await page.locator("section").screenshot({ path: testInfo.outputPath("purchased-clues.png") });
});
test("host reveals do not buy clues and hiding removes only public clues", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Close round" }).click();
  await page.getByRole("button", { name: "Show Photo clue" }).click();
  await page.getByRole("button", { name: "View as player" }).click();
  await expect(page.getByText("Shown by host", { exact: true })).toBeVisible();
  await expect(page.getByText("Clue hidden", { exact: true })).toHaveCount(1);
  await expect(page.getByText("5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change question" }).click();
  await expect(page.getByText("Clue hidden", { exact: true })).toHaveCount(2);
  await expect(page.getByText("The skyline", { exact: true })).toHaveCount(0);
});

test("media-only general clues, paid clues, and answers use the shared audio/video renderer", async ({ page }) => {
  await setup(page, "media");
  await expect(page.locator("audio")).toHaveCount(2);
  await expect(page.locator("video")).toHaveCount(2);
  for (const media of await page.locator("audio,video").all()) await expect(media).toHaveAttribute("controls", "");
  await expect(page.getByText("Clue hidden", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A clip", { exact: true })).toBeVisible();
});

function silentWave(seconds = 10) {
  const size = 8000 * seconds * 2, wave = Buffer.alloc(44 + size);
  wave.write("RIFF"); wave.writeUInt32LE(36 + size, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(size, 40);
  return wave;
}
async function preparePlayback(page: import("@playwright/test").Page, kind: "audio" | "video") {
  const media = page.locator(kind).first();
  await expect.poll(() => media.evaluate((element) => (element as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(3);
  await media.evaluate(async (element) => {
    const player = element as HTMLMediaElement;
    player.muted = true; await player.play();
    await new Promise<void>((resolve) => {
      player.addEventListener("seeked", () => resolve(), { once: true });
      player.currentTime = 2;
    });
    (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral = player;
  });
  expect(await media.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeGreaterThanOrEqual(2);
  return media;
}
for (const kind of ["audio", "video"] as const) test(`revealing answer media pauses and rewinds general ${kind} while text answers leave it playing`, async ({ page }) => {
  await setup(page, "playback", kind);
  const general = await preparePlayback(page, kind);
  await page.getByRole("button", { name: "Reveal text answer", exact: true }).click();
  expect(await general.evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
  await page.getByRole("button", { name: "Reveal media answer", exact: true }).click();
  await expect(page.locator(kind)).toHaveCount(2);
  await expect.poll(() => general.evaluate((element) => (element as HTMLMediaElement).paused)).toBe(true);
  expect(await general.evaluate((element) => (element as HTMLMediaElement).currentTime)).toBe(0);
  expect(await general.evaluate((element) => (element as HTMLMediaElement).autoplay)).toBe(false);
  expect(await page.locator(kind).last().evaluate((element) => (element as HTMLMediaElement).autoplay)).toBe(true);
});


test("purchases stream balance and content from Firestore and survive reconnect without a content GET", async ({ page }) => {
  const initial: Fixture = { teamId: "red", remainingCoins: 5, clues: [{ id: "two", category: "History", price: 2, purchased: false }, { id: "three", category: "Word", price: 3, purchased: false }] };
  let current = initial, charges = 0, contentReads = 0;
  page.on("request", (request) => { if (request.method() === "GET" && request.url().endsWith("/clues")) contentReads++; });
  await seed(page, initial);
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues/*", async (route) => {
    expect(route.request().method()).toBe("POST");
    const id = route.request().url().split("/").at(-1);
    const clue = current.clues.find((item) => item.id === id)!;
    current = { ...current, remainingCoins: current.remainingCoins - clue.price, clues: current.clues.map((item) => item.id === id ? { ...item, purchased: true, content: { text: id === "two" ? "A capital" : "Five letters" } } : item) };
    charges++; await route.fulfill({ json: { remainingCoins: current.remainingCoins } });
    await publish(page, current);
  });
  await setup(page, "live");
  await page.getByRole("button", { name: "Open for 2", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open for 3", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(2);
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByText("Five letters", { exact: true })).toBeVisible();
  expect(charges).toBe(2); expect(contentReads).toBe(0);
});

test("last-coin unlock streams before Storage media finishes downloading", async ({ page }) => {
  const clue = { id: "audio", category: "Audio", price: 5 };
  await seed(page, { teamId: "red", remainingCoins: 5, clues: [{ ...clue, purchased: false }] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/clues/audio", async (route) => {
    await route.fulfill({ json: { remainingCoins: 0 } });
    await publish(page, { teamId: "red", remainingCoins: 0, clues: [{ ...clue, purchased: true, content: { media: { filename: "clue.wav", storagePath: "rooms/demo/media/clue.wav" } } }] });
  });
  await page.route("**/test-storage/rooms/demo/media/clue.wav", async (route) => { await gate; await route.fulfill({ contentType: "audio/wav", body: silentWave() }); });
  await setup(page, "live");
  try {
    await page.getByRole("button", { name: "Open for 5", exact: true }).click();
    await expect(page.getByText("Opened", { exact: true })).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading media…", { exact: true })).toBeVisible();
    release(); await expect(page.locator('audio[src^="blob:"]')).toBeVisible();
  } finally { release(); }
});

for (const kind of ["audio", "video"] as const) for (const trigger of ["own", "teammate"] as const) test(`${trigger} purchase snapshots preserve general ${kind} playback`, async ({ page }) => {
  await seed(page, hidden);
  await page.route("**/clues/hint", (route) => route.fulfill({ json: { remainingCoins: 3 } }));
  await setup(page, "live-media", kind); await preparePlayback(page, kind);
  if (trigger === "own") await page.getByRole("button", { name: "Open for 2", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
  await publish(page, bought);
  await expect(page.getByText("Opened", { exact: true })).toBeVisible();
  expect(await page.locator(kind).first().evaluate((element) => element === (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral)).toBe(true);
  expect(await page.locator(kind).first().evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
  expect(await page.locator(kind).first().evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeGreaterThanOrEqual(2);
  await publish(page, undefined, true);
  await expect(page.getByRole("alert")).toHaveText("Clue subscription failed");
  expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
});

for (const change of ["question", "viewer"] as const) test(`changing ${change} clears prior clue content and media identity`, async ({ page }) => {
  await seed(page, bought); await setup(page, "live-media"); await preparePlayback(page, "audio");
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: change === "question" ? "Change question" : "Change viewer", exact: true }).click();
  await expect(page.getByText("A capital", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open for 2", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(false);
});

test("hiding a public clue immediately removes its content and preserves purchased clues and playback", async ({ page }) => {
  await seed(page, { ...bought, clues: [...bought.clues, { id: "public", category: "Public", price: 2, purchased: false, content: { text: "Public clue" } }] });
  await setup(page, "live-media"); await preparePlayback(page, "audio");
  await page.getByRole("button", { name: "Show public clues", exact: true }).click();
  await expect(page.getByText("Public clue", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide public clues", exact: true }).click();
  await expect(page.getByText("Public clue", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  expect(await page.locator("audio").evaluate((element) => element === (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral)).toBe(true);
  expect(await page.locator("audio").evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
});

test("teammate purchases preserve already purchased media without downloading it again", async ({ page }) => {
  const sound = { id: "sound", category: "Sound", price: 1, purchased: true, content: { media: { filename: "sound.wav", storagePath: "rooms/demo/media/sound.wav" } } };
  await seed(page, { ...hidden, remainingCoins: 4, clues: [sound, ...hidden.clues] });
  let downloads = 0;
  await page.route("**/test-storage/rooms/demo/media/sound.wav", (route) => { downloads++; return route.fulfill({ contentType: "audio/wav", body: silentWave() }); });
  await setup(page, "live-media");
  await expect(page.locator("audio")).toHaveCount(2);
  const paid = page.locator("audio").nth(1);
  await expect.poll(() => paid.evaluate((element) => (element as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(3);
  const original = await paid.elementHandle();
  await paid.evaluate(async (element) => { const player = element as HTMLMediaElement; player.muted = true; await player.play(); });
  await publish(page, { ...bought, remainingCoins: 2, clues: [sound, ...bought.clues] });
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await paid.evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
  expect(downloads).toBe(1);
});

for (const id of ["constructor", "toString", "valueOf"] as const) {
  test(`prototype-named clue ${id} stays locked until purchased and loads its media`, async ({ page }) => {
    const clue = { id, category: "Named clue", price: 2 };
    await seed(page, { teamId: "red", remainingCoins: 5, clues: [{ ...clue, purchased: false }] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/rooms/demo/rounds/r1/answers/q1/clues/${id}`, async (route) => {
      await route.fulfill({ json: { remainingCoins: 3 } });
      await publish(page, { teamId: "red", remainingCoins: 3, clues: [{ ...clue, purchased: true, content: { text: "Purchased content", media: { filename: "clue.wav", storagePath: "rooms/demo/media/clue.wav" } } }] });
    });
    await page.route("**/test-storage/rooms/demo/media/clue.wav", async (route) => { await gate; await route.fulfill({ contentType: "audio/wav", body: silentWave() }); });
    await setup(page, "live");
    try {
      await expect(page.getByText("Opened", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Clue hidden", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Open for 2", exact: true }).click();
      await expect(page.getByText("Opened", { exact: true })).toBeVisible();
      await expect(page.getByText("Purchased content", { exact: true })).toBeVisible();
      await expect(page.getByText("3", { exact: true })).toBeVisible();
      await expect(page.getByText("Loading media…", { exact: true })).toBeVisible();
      await expect(page.locator("audio")).toHaveCount(0);
      release();
      await expect(page.locator('audio[src^="blob:"]')).toBeVisible();
    } finally { release(); }
  });

  test(`prototype-named clue ${id} supports public reveal and hide without a purchase`, async ({ page }) => {
    await seed(page, { teamId: "red", remainingCoins: 5, clues: [{ id, category: "Named clue", price: 2, purchased: false, content: { text: "Public content" } }] });
    await setup(page, "live-media");
    await expect(page.getByText("Opened", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Public content", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Show public clues", exact: true }).click();
    await expect(page.getByText("Public content", { exact: true })).toBeVisible();
    await expect(page.getByText("Shown by host", { exact: true })).toBeVisible();
    await expect(page.getByText("Opened", { exact: true })).toHaveCount(0);
    await expect(page.getByText("5", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hide public clues", exact: true }).click();
    await expect(page.getByText("Public content", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Clue hidden", { exact: true })).toBeVisible();
  });
}


test("paid clues sharing a room media path download the asset once", async ({ page }) => {
  await seed(page, { teamId: "red", remainingCoins: 3, clues: ["first", "second"].map((id) => ({
    id, category: id, price: 1, purchased: true, content: { media: { filename: "shared.wav", storagePath: "rooms/demo/media/shared.wav" } },
  })) });
  let downloads = 0;
  await page.route("**/test-storage/rooms/demo/media/shared.wav", (route) => {
    downloads++;
    return route.fulfill({ contentType: "audio/wav", body: silentWave() });
  });
  await setup(page, "live");
  await expect(page.locator('audio[src^="blob:"]')).toHaveCount(2);
  const sources = await page.locator("audio").evaluateAll((elements) => elements.map((element) => (element as HTMLAudioElement).src));
  expect(sources[0]).toBe(sources[1]);
  expect(downloads).toBe(1);
});
