import { test, expect } from "@playwright/test";
import { build } from "esbuild";

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
    function LiveHarness(){const [generation,setGeneration]=useState(0);return <><button onClick={()=>setGeneration(generation+1)}>Reconnect</button><CluesPresenting key={generation} roomSlug="demo" round={{id:'r1',title:'Clues',type:'clues',state:'active',order:0,startingCoins:5}} question={{id:'q1',prompt:'Name the place',displayPrompt:'Name the place',order:0}} teamId="red" isHost={false} revealedClueIds={[]} pending={false} onReveal={()=>{}}/></>;}

    function PlaybackHarness(){const [answer,setAnswer]=useState(null);return <>
      <button onClick={()=>setAnswer({text:'Paris',media:{filename:'answer.${mediaKind === "audio" ? "wav" : "webm"}',url:window.playbackSource}})}>Reveal media answer</button>
      <button onClick={()=>setAnswer({text:'Paris'})}>Reveal text answer</button>
      <button onClick={()=>setAnswer(null)}>Hide answer</button>
      <CluesQuestionView generalClue={{text:'Name the place',media:{filename:'general.${mediaKind === "audio" ? "wav" : "webm"}',url:window.playbackSource}}}
        answer={answer} startingCoins={5} view={{teamId:'red',remainingCoins:5,clues:[]}} isHost={false} closed={true} revealedClueIds={[]} pending={false} onReveal={()=>{}} onPurchase={()=>{}}/>
    </>;}
    function LiveMediaHarness(){const [question,setQuestion]=useState('q1'),[team,setTeam]=useState('red'),[revealed,setRevealed]=useState([]),[closed,setClosed]=useState(false);return <>
      <button onClick={()=>setQuestion('q2')}>Change question</button><button onClick={()=>setTeam('blue')}>Change viewer</button>
      <button onClick={()=>{setClosed(true);setRevealed(['public']);}}>Show public clues</button><button onClick={()=>setRevealed([])}>Hide public clues</button>
      <CluesPresenting roomSlug="demo" round={{id:'r1',title:'Clues',type:'clues',state:closed?'closed':'active',order:0,startingCoins:5}}
        question={{id:question,prompt:'Name the place',displayPrompt:'Name the place',order:0}} teamId={team} isHost={false}
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
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firebase/firestore", namespace: "clues-firestore" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-firestore" }, () => ({ contents: "export const doc=(...args)=>args;export const onSnapshot=(ref,callback)=>{window.emitClueLedger=callback;callback();return ()=>{if(window.emitClueLedger===callback)delete window.emitClueLedger;};};" }));
      builder.onResolve({ filter: /^(@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "clues-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-mock" }, (args) => ({ contents: args.path.includes("firebase-auth") ? "const getToken=async()=>'';export const useFirebaseAuth=()=>({getToken});" : "export const getClientFirestore=()=>({});" }));
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

test("live purchase UI spends the last coins once and restores purchases on reconnect", async ({ page }) => {
  let remainingCoins = 5;
  const purchased = new Set<string>();
  const charges: string[] = [];
  const clues = [{ id: "two", category: "History", price: 2, text: "A capital" }, { id: "three", category: "Word", price: 3, text: "Five letters" }];
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const id = new URL(request.url()).pathname.split("/").at(-1)!;
      const clue = clues.find((item) => item.id === id)!;
      if (!purchased.has(id)) { remainingCoins -= clue.price; purchased.add(id); charges.push(id); }
      await route.fulfill({ json: { remainingCoins } });
    } else await route.fulfill({ json: { teamId: "red", remainingCoins, clues: clues.map(({ text, ...metadata }) => ({ ...metadata, purchased: purchased.has(metadata.id), ...(purchased.has(metadata.id) ? { content: { text } } : {}) })) } });
  });
  await setup(page, "live");
  await page.getByRole("button", { name: "Open for 2", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open for 3", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(2);
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  expect(charges).toEqual(["two", "three"]);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByText("Opened", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Five letters", { exact: true })).toBeVisible();
  expect(charges).toEqual(["two", "three"]);
});

test("media-only general clues, paid clues, and answers use the shared audio/video renderer", async ({ page }) => {
  await setup(page, "media");
  await expect(page.locator("audio")).toHaveCount(2);
  await expect(page.locator("video")).toHaveCount(2);
  for (const media of await page.locator("audio,video").all()) await expect(media).toHaveAttribute("controls", "");
  await expect(page.getByText("Clue hidden", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A clip", { exact: true })).toBeVisible();
});

test("last-coin media purchase reveals its balance and unlock before media finishes downloading", async ({ page }) => {
  let purchased = false, charges = 0;
  let releaseMedia!: () => void;
  const pendingMedia = new Promise<void>((resolve) => { releaseMedia = resolve; });
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues", (route) => route.fulfill({ json: {
    teamId: "red", remainingCoins: purchased ? 0 : 5,
    clues: [{ id: "audio", category: "Audio", price: 5, purchased, ...(purchased ? { content: { media: { filename: "clue.wav" } } } : {}) }],
  } }));
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues/audio", (route) => {
    purchased = true; charges++;
    return route.fulfill({ json: { remainingCoins: 0 } });
  });
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues/audio/media", async (route) => {
    await pendingMedia;
    const wave = Buffer.alloc(46);
    wave.write("RIFF"); wave.writeUInt32LE(38, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(2, 40);
    await route.fulfill({ contentType: "audio/wav", body: wave });
  });
  await setup(page, "live");
  try {
    await page.getByRole("button", { name: "Open for 5", exact: true }).click();
    await expect(page.getByText("Opened", { exact: true })).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading media…", { exact: true })).toBeVisible();
    expect(charges).toBe(1);
    releaseMedia();
    await expect(page.locator('audio[src^="blob:"]')).toBeVisible();
    await expect.poll(() => page.locator("audio").evaluate((audio) => (audio as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
  } finally { releaseMedia(); }
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

for (const kind of ["audio", "video"] as const) for (const trigger of ["own", "teammate"] as const) test(`${trigger} purchases preserve general ${kind} during and after a delayed refresh`, async ({ page }) => {
  let purchased = false, blocked = false, fail = false;
  let release!: () => void, started!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues**", async (route) => {
    if (route.request().method() === "POST") { purchased = true; await route.fulfill({ json: { remainingCoins: 3 } }); return; }
    if (blocked) { started(); await responseGate; }
    if (fail) { await route.fulfill({ status: 500, json: { message: "Clue refresh failed" } }); return; }
    await route.fulfill({ json: { teamId: "red", remainingCoins: purchased ? 3 : 5,
      clues: [{ id: "hint", category: "History", price: 2, purchased, ...(purchased ? { content: { text: "A capital" } } : {}) }],
    } });
  });
  await setup(page, "live-media", kind);
  await preparePlayback(page, kind);
  blocked = true;
  try {
    if (trigger === "own") await page.getByRole("button", { name: "Open for 2", exact: true }).click();
    else { purchased = true; await page.evaluate(() => (window as unknown as { emitClueLedger: () => void }).emitClueLedger()); }
    await requestStarted;
    expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
    release();
    await expect(page.getByText("Opened", { exact: true })).toBeVisible();
    expect(await page.locator(kind).first().evaluate((element) => element === (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral)).toBe(true);
    expect(await page.locator(kind).first().evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
    expect(await page.locator(kind).first().evaluate((element) => (element as HTMLMediaElement).currentTime)).toBeGreaterThanOrEqual(2);
    fail = true;
    await page.evaluate(() => (window as unknown as { emitClueLedger: () => void }).emitClueLedger());
    await expect(page.getByRole("alert")).toHaveText("Clue refresh failed");
    expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
  } finally { release(); }
});

for (const change of ["question", "viewer"] as const) test(`changing the ${change} clears prior clue data and gives media a new identity`, async ({ page }) => {
  let team = "red", changed = false;
  let release!: () => void, started!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/rooms/demo/rounds/r1/answers/*/clues", async (route) => {
    if (changed) { started(); await responseGate; }
    await route.fulfill({ json: { teamId: team, remainingCoins: changed ? 5 : 3,
      clues: [{ id: "hint", category: "History", price: 2, purchased: !changed, ...(!changed ? { content: { text: "Previous private clue" } } : {}) }],
    } });
  });
  await setup(page, "live-media"); await preparePlayback(page, "audio");
  await expect(page.getByText("Previous private clue", { exact: true })).toBeVisible();
  changed = true; if (change === "viewer") team = "blue";
  try {
    await page.getByRole("button", { name: change === "question" ? "Change question" : "Change viewer", exact: true }).click();
    await requestStarted;
    expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(false);
    await expect(page.getByText("Previous private clue", { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole("button", { name: "Open for 2", exact: true })).toBeVisible();
    expect(await page.locator("audio").evaluate((element) => element === (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral)).toBe(false);
  } finally { release(); }
});

test("hiding public clues immediately hides stale content while preserving purchases and general playback", async ({ page }) => {
  let showing = false, blockHide = false;
  let release!: () => void, started!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues", async (route) => {
    if (blockHide) { started(); await responseGate; await route.fulfill({ status: 500, json: { message: "Clue refresh failed" } }); return; }
    await route.fulfill({ json: { teamId: "red", remainingCoins: 3, clues: [
      { id: "paid", category: "Paid", price: 2, purchased: true, content: { text: "Purchased clue" } },
      { id: "public", category: "Public", price: 2, purchased: false, ...(showing ? { content: { text: "Public clue" } } : {}) },
    ] } });
  });
  await setup(page, "live-media"); await preparePlayback(page, "audio");
  showing = true;
  await page.getByRole("button", { name: "Show public clues", exact: true }).click();
  await expect(page.getByText("Public clue", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
  showing = false; blockHide = true;
  try {
    await page.getByRole("button", { name: "Hide public clues", exact: true }).click(); await requestStarted;
    await expect(page.getByText("Public clue", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Purchased clue", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { savedGeneral: HTMLMediaElement }).savedGeneral.isConnected)).toBe(true);
    release();
    await expect(page.getByRole("alert")).toHaveText("Clue refresh failed");
    await expect(page.getByText("Public clue", { exact: true })).toHaveCount(0);
    expect(await page.locator("audio").evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
  } finally { release(); }
});

test("a teammate purchase keeps already purchased media playing without downloading it again", async ({ page }) => {
  let boughtHint = false, downloads = 0;
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues/sound/media", (route) => {
    downloads++;
    return route.fulfill({ contentType: "audio/wav", body: silentWave() });
  });
  await page.route("**/api/rooms/demo/rounds/r1/answers/q1/clues", (route) => route.fulfill({ json: {
    teamId: "red", remainingCoins: boughtHint ? 2 : 4, clues: [
      { id: "sound", category: "Sound", price: 1, purchased: true, content: { media: { filename: "sound.wav" } } },
      { id: "hint", category: "History", price: 2, purchased: boughtHint, ...(boughtHint ? { content: { text: "A capital" } } : {}) },
    ],
  } }));
  await setup(page, "live-media");
  await expect(page.locator("audio")).toHaveCount(2);
  const paid = page.locator("audio").nth(1);
  await expect.poll(() => paid.evaluate((element) => (element as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(3);
  const original = await paid.elementHandle();
  await paid.evaluate(async (element) => {
    const player = element as HTMLMediaElement;
    player.muted = true; await player.play();
    await new Promise<void>((resolve) => { player.addEventListener("seeked", () => resolve(), { once: true }); player.currentTime = 0.1; });
  });
  boughtHint = true;
  await page.evaluate(() => (window as unknown as { emitClueLedger: () => void }).emitClueLedger());
  await expect(page.getByText("A capital", { exact: true })).toBeVisible();
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await paid.evaluate((element) => (element as HTMLMediaElement).paused)).toBe(false);
  expect(downloads).toBe(1);
});
