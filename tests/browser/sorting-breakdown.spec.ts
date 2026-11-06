import { test, expect } from "@playwright/test";
import { build } from "esbuild";

async function fixtureBundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Breakdown from './app/[room]/team-score-breakdown-dialog';
      import { SortingPresentationControls } from './lib/components/room/sorting-presentation-controls';
      import { SortingRound } from './lib/components/sorting-round';
      const root = createRoot(document.getElementById('fixture'));
      window.showBreakdown = (isHost = false, scored = true) => root.render(<Breakdown isOpen onClose={() => {}} roomSlug="demo" teamId="red" teamName="Red" isHost={isHost}
        roundsMeta={[{id:'sorting',title:'Timeline',type:'sorting',order:0,state:'closed',gradingRequired:!scored,criterion:'Earliest to latest'}]}
        roundQuestions={{sorting:['a','b','c','d'].map((id,index) => ({id,order:index,prompt:id.toUpperCase(),displayPrompt:id.toUpperCase(),...(id==='b'?{media:{storagePath:'b.svg',filename:'b.svg'}}:{})}))}}
        onPointsUpdated={async () => { window.pointsUpdated++; }} />);
      function Host({state,ready}) {
        const [presentation,setPresentation] = React.useState(null);
        const present = withAnswer => { const next={round:'sorting',question:null,withAnswer}; window.presentationUpdates.push(next); setPresentation(next); };
        return <><SortingPresentationControls state={state} presented={!!presentation} revealing={presentation?.withAnswer===true} pending={false} ending={false} retryScoring={false}
          onPresent={present} onHide={()=>setPresentation(null)} onEnd={()=>{}} onScore={()=>{}} />
          {presentation?<SortingRound roomSlug="demo" roundId="sorting" criterion="Earliest to latest" questions={ready?['a','b','c','d'].map(id=>({id,text:id.toUpperCase()})):[]}
            startingOrder={['d','b','a','c']} state={state} readOnly reveal={presentation.withAnswer} />:null}</>;
      }
      window.showHost = (state='closed',ready=true) => root.render(<Host state={state} ready={ready} />);
      window.showBreakdown();`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "breakdown-fixture", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `
          export const doc = (_, ...parts) => parts.join('/'); export const collection = doc; export const query=(path)=>path; export const orderBy=()=>null;
          export const getDoc = async path => { window.reads.push(path); return {data:()=>structuredClone(window.docs[path])}; };
          export const getDocs = async () => { throw new Error('Sorting results must be read at round level'); };
          export const serverTimestamp = () => 'now';
          export const setDoc = async () => { throw new Error('Sorting points require an atomic update'); };
          export const onSnapshot = (path,callback) => {queueMicrotask(()=>callback({data:()=>structuredClone(window.docs[path])}));return()=>{};};
          export const runTransaction = async (_, update) => update({get:getDoc,set:(path,data)=>{window.docs[path]={...window.docs[path],...data};}});` };
        if (args.path === "firebase/storage") return { contents: `export const getStorage=()=>({});export const ref=(_,path)=>path;export const getDownloadURL=async()=> 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>');` };
        if (args.path.includes("firebase-auth-provider")) return { contents: `export const useFirebaseAuth=()=>({user:{uid:'red'},getToken:async()=> 'red'});` };
        return { contents: `export const getClientFirestore=()=>({});export const getFirebaseClientApp=()=>({});` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Fixture = { showBreakdown: (host?: boolean, scored?: boolean) => void; reads: string[]; pointsUpdated: number; docs: Record<string, {order?:string[];correctOrder?:string[];awardedPoints?:number;pointsByQuestion?:Record<string,number>;graded?:boolean}> };
async function setup(page: import("@playwright/test").Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", {name:"Add round",exact:true})).toBeVisible();
  const css = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__breakdown-fixture", (route) => route.fulfill({contentType:"text/html",body:`<html><head>${css.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><div id="fixture"></div></body></html>`}));
  await page.goto("/__breakdown-fixture");
  await page.evaluate(() => {
    Object.assign(window, {reads:[], pointsUpdated:0, presentationUpdates:[], docs:{
      "rooms/demo/rounds/sorting/answers/order":{correctOrder:["a","b","c","d"]},
      "rooms/demo/rounds/sorting/teamAnswers/red":{order:["a","c","b","d"],revision:3,user:"red",graded:true,awardedPoints:2,pointsByQuestion:{a:1,b:0,c:0,d:1}},
    }});
  });
  await page.addScriptTag({content:await fixtureBundle()});
}

for (const width of [1440,390]) test(`closed scored sorting compares orders and per-item points at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width,height:900});
  await setup(page);
  const modal = page.getByRole("dialog",{name:"Team score breakdown"});
  await expect(modal.getByRole("heading",{name:"Red · 2 pts"})).toBeVisible();
  await expect(modal.getByText("Earliest to latest",{exact:true})).toBeVisible();
  for (const [position,correct,submitted,points] of [[1,"A","A",1],[2,"B","C",0],[3,"C","B",0],[4,"D","D",1]] as const) {
    const row=modal.getByRole("listitem",{name:`Position ${position}`,exact:true});
    await expect(row.getByLabel("Correct item",{exact:true}).getByText(correct,{exact:true})).toBeVisible();
    await expect(row.getByLabel("Submitted item",{exact:true}).getByText(submitted,{exact:true})).toBeVisible();
    await expect(row.getByRole("spinbutton")).toHaveValue(String(points));
    await expect(row.getByRole("spinbutton")).toBeDisabled();
  }
  await modal.getByRole("listitem",{name:"Position 2",exact:true}).getByRole("button",{name:"Zoom image",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"B",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close zoomed image",exact:true}).click();
  await modal.screenshot({path:testInfo.outputPath(`sorting-comparison-${width}.png`)});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Fixture).reads)).toContain("rooms/demo/rounds/sorting/answers/order");
});

test("unscored sorting does not request the private order", async ({page}) => {
  await setup(page);
  await expect(page.getByRole("heading",{name:"Red · 2 pts"})).toBeVisible();
  await page.evaluate(() => { const w=window as unknown as Fixture; w.reads=[]; w.showBreakdown(false,false); });
  await expect(page.getByText("Awaiting scoring",{exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Fixture).reads)).not.toContain("rooms/demo/rounds/sorting/answers/order");
});

test("host adjusts per-item points on the frozen round submission", async ({page}) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as Fixture).showBreakdown(true));
  const row=page.getByRole("listitem",{name:"Position 2",exact:true});
  await row.getByRole("spinbutton").fill("0.5");
  await row.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).pointsUpdated)).toBe(1);
  const data=await page.evaluate(() => (window as unknown as Fixture).docs["rooms/demo/rounds/sorting/teamAnswers/red"]);
  expect(data.awardedPoints).toBe(2.5);
  expect(data.pointsByQuestion).toEqual({a:1,b:0,c:0.5,d:1});
});


test("host presents and hides the whole sorting answer with no selected question", async ({page}) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as {showHost:()=>void}).showHost());
  await page.getByRole("button",{name:"Show round",exact:true}).click();
  const ids=()=>page.getByRole("list",{name:"Sorting order",exact:true}).locator(":scope > li").evaluateAll(rows=>rows.map(row=>row.getAttribute("data-item-id")));
  await expect.poll(ids).toEqual(["d","b","a","c"]);
  await page.getByRole("button",{name:"Show answer",exact:true}).click();
  await expect(page.getByRole("region",{name:"Correct order",exact:true})).toBeVisible();
  await expect.poll(ids).toEqual(["a","b","c","d"]);
  expect(await page.evaluate(() => (window as unknown as {presentationUpdates:unknown[]}).presentationUpdates)).toEqual([
    {round:"sorting",question:null,withAnswer:false},{round:"sorting",question:null,withAnswer:true},
  ]);
  await page.getByRole("button",{name:"Hide answer",exact:true}).click();
  await expect(page.getByRole("region",{name:"Correct order",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Hide round",exact:true}).click();
  await expect(page.getByRole("list",{name:"Sorting order",exact:true})).toHaveCount(0);
});


test("starting-order metadata may arrive before sorting question documents", async ({page}) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as {showHost:(state:string,ready:boolean)=>void}).showHost("closed",false));
  await page.getByRole("button",{name:"Show round",exact:true}).click();
  await expect(page.getByText("Loading sorting items…",{exact:true})).toBeVisible();
  await page.evaluate(() => (window as unknown as {showHost:(state:string,ready:boolean)=>void}).showHost("closed",true));
  await expect(page.getByRole("list",{name:"Sorting order",exact:true}).locator(":scope > li")).toHaveCount(4);
});
