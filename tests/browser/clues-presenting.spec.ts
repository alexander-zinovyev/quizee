import { test, expect } from "@playwright/test";
import { build } from "esbuild";

async function setup(page: import("@playwright/test").Page, live = false) {
  await page.goto("/build");
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__clues-view", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main></main></body></html>` }));
  await page.goto("/__clues-view");
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CluesQuestionView,CluesPresenting} from './lib/components/clues-presenting';
    function LiveHarness(){const [generation,setGeneration]=useState(0);return <><button onClick={()=>setGeneration(generation+1)}>Reconnect</button><CluesPresenting key={generation} roomSlug="demo" round={{id:'r1',title:'Clues',type:'clues',state:'active',order:0,startingCoins:5}} question={{id:'q1',prompt:'Name the place',displayPrompt:'Name the place',order:0}} teamId="red" isHost={false} revealedClueIds={[]} pending={false} onReveal={()=>{}}/></>;}

    function Harness(){
      const [host,setHost]=useState(true),[closed,setClosed]=useState(false),[revealed,setRevealed]=useState([]),[purchased,setPurchased]=useState([]),[coins,setCoins]=useState(5);
      const clues=[{id:'history',category:'History',price:2,text:'A capital'}, {id:'photo',category:'Photo',price:3,text:'The skyline',image:true}];
      return <><button onClick={()=>setHost(!host)}>{host?'View as player':'View as host'}</button><button onClick={()=>setClosed(true)}>Close round</button><button onClick={()=>setRevealed([])}>Change question</button>
        <section className="w-[850px] max-w-full bg-black"><CluesQuestionView prompt="Name the place" startingCoins={5} isHost={host} closed={closed} revealedClueIds={revealed} pending={false}
          images={{photo:'/clues/coins.svg'}} view={{teamId:'red',remainingCoins:coins,clues:clues.map(clue=>{const visible=host||purchased.includes(clue.id)||revealed.includes(clue.id);return {id:clue.id,category:clue.category,price:clue.price,purchased:purchased.includes(clue.id),...(visible?{text:clue.text,image:clue.image}:{})};})}}
          onReveal={setRevealed} onPurchase={id=>{const price=clues.find(clue=>clue.id===id).price;if(price<=coins){setPurchased([...purchased,id]);setCoins(coins-price);}}}/></section></>;
    }createRoot(document.querySelector('main')).render(${live ? '<LiveHarness/>' : '<Harness/>'});`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "clues-transport", setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firebase/firestore", namespace: "clues-firestore" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-firestore" }, () => ({ contents: "export const doc=(...args)=>args;export const onSnapshot=(ref,callback)=>{callback();return ()=>{};};" }));
      builder.onResolve({ filter: /^(@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "clues-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "clues-mock" }, (args) => ({ contents: args.path.includes("firebase-auth") ? "const getToken=async()=>'';export const useFirebaseAuth=()=>({getToken});" : "export const getClientFirestore=()=>({});" }));
    } }],
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole("heading", { name: "Name the place" })).toBeVisible();
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
    } else await route.fulfill({ json: { teamId: "red", remainingCoins, clues: clues.map(({ text, ...metadata }) => ({ ...metadata, purchased: purchased.has(metadata.id), ...(purchased.has(metadata.id) ? { text } : {}) })) } });
  });
  await setup(page, true);
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
