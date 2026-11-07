import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

test.use({ colorScheme: "light" });

async function fixtureBundle() {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import HostPanel from './app/[room]/room-host-rounds-panel';
      const root=createRoot(document.getElementById('fixture'));
      const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="75"><rect width="150" height="75" fill="teal"/></svg>');
      const ids=Array.from({length:8},(_,index)=>String(index+1));
      let presentation={round:null,question:null,withAnswer:false};
      let current={type:'text',state:'scheduled',pending:false,questionsLoaded:true,gradingRequired:false};
      const record=(action,...args)=>{window.actions.push([action,...args]);};
      const callbacks={
        onStartRound:id=>record('start',id),onEndRound:id=>record('end',id),onGradeRound:id=>record('grade',id),
        onPresentQuestion:(id,question)=>{record('question',id,question);presentation={round:id,question,withAnswer:false};render();},
        onHideQuestion:()=>{record('hide');presentation={round:null,question:null,withAnswer:false};render();},
        onRevealRound:(id,withAnswer)=>{record('reveal',id,withAnswer);presentation={round:id,question:null,withAnswer};render();},
      };
      function render(){
        const {type,state,pending,questionsLoaded,gradingRequired}=current;
        const round={id:type,title:type==='image'?'World flags':type==='sorting'?'Timeline':'Capital cities',type,state,order:0,roundNumber:1,
          criterion:'Earliest to latest',correctOrder:[...ids].reverse(),questionsLoaded,gradingRequired,
          sortingQuestions:questionsLoaded?ids.map(id=>({id,text:'Item '+id})):[],
          images:ids.map(id=>({id,src:image,alt:'Flag '+id})),
          questions:ids.map((id,index)=>({id,prompt:type==='image'?'Country '+id:'Question '+id,answer:type==='image'?id:index===0?'':'Answer '+id,order:index})),
        };
        root.render(<HostPanel rounds={[round,{...round,id:'other',title:'Other round'}]} selectedRoundId={type} presenting={presentation} pending={pending} {...callbacks}/>);
      }
      window.renderHost=(type='text',state='scheduled',pending=false,questionsLoaded=true,gradingRequired=false)=>{current={type,state,pending,questionsLoaded,gradingRequired};presentation={round:null,question:null,withAnswer:false};render();};
      window.renderHost();
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic",
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "host-fixture", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/(firestore|storage)|@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => {
        if (args.path === "firebase/firestore") return { contents: `export const doc=()=>null;export const onSnapshot=()=>{throw new Error('Host content must use supplied data');};` };
        if (args.path === "firebase/storage") return { contents: `export const getStorage=()=>null;export const ref=()=>null;export const getDownloadURL=async()=>{throw new Error('Fixture has no item media');};` };
        if (args.path.includes("firebase-auth-provider")) return { contents: `export const useFirebaseAuth=()=>({user:{uid:'host'},getToken:async()=> 'host'});` };
        return { contents: `export const getClientFirestore=()=>null;export const getFirebaseClientApp=()=>null;` };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

type Fixture = {
  renderHost: (type: string, state: string, pending?: boolean, questionsLoaded?: boolean, gradingRequired?: boolean) => void;
  actions: Array<Array<string | boolean>>;
};
async function setup(page: Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const css = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__interactive-host", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${css.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body style="margin:0"><main id="fixture" style="width:min(762px,100vw);height:422px"></main></body></html>` }));
  await page.goto("/__interactive-host");
  await page.evaluate(() => { (window as unknown as Fixture).actions = []; });
  await page.addScriptTag({ content: await fixtureBundle() });
  await expect(page.getByRole("heading", { name: "Capital cities" })).toBeVisible();
}
async function render(page: Page, type: string, state: string, pending = false) {
  await page.evaluate(({ type, state, pending }) => (window as unknown as Fixture).renderHost(type, state, pending), { type, state, pending });
}

for (const width of [1440, 390]) test(`host round lifecycle content and controls at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  for (const type of ["text", "image", "sorting"]) {
    await render(page, type, "scheduled");
    await expect(page.getByRole("button", { name: "Activate", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Show question/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await render(page, type, "active");
    await page.getByRole("button", { name: "End round", exact: true }).click();
    await render(page, type, "closed");
    await expect(page.getByRole("button", { name: "Activate", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "End round", exact: true })).toHaveCount(0);
    if (type !== "text") {
      await page.getByRole("button", { name: "Show answers", exact: true }).click();
      await page.getByRole("button", { name: "Hide answers", exact: true }).click();
      await expect(page.getByRole("button", { name: "Show answers", exact: true })).toBeVisible();
    }
    await page.getByRole("region", { name: /^Host round:/ }).screenshot({ path: testInfo.outputPath(`host-${type}-${width}.png`) });
  }
  const actions = await page.evaluate(() => (window as unknown as Fixture).actions);
  expect(actions).toEqual([
    ["start", "text"], ["end", "text"],
    ["start", "image"], ["end", "image"], ["reveal", "image", true], ["reveal", "image", false],
    ["start", "sorting"], ["end", "sorting"], ["reveal", "sorting", true], ["reveal", "sorting", false],
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("host can present media-only answer questions and hide them without changing selected round", async ({ page }) => {
  await setup(page);
  await render(page, "text", "active");
  await expect(page.getByText("1. Question 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show question 1", exact: true }).locator("img")).toHaveAttribute("src", "/interactive-panel/eye.svg");
  await page.getByRole("button", { name: "Show question 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide question 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  const hideIcon = page.getByRole("button", { name: "Hide question 1", exact: true }).locator("img");
  await expect(hideIcon).toHaveAttribute("src", "/interactive-panel/eye-slash.svg");
  await expect.poll(() => hideIcon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(32);
  await page.getByRole("button", { name: "Hide question 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capital cities" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Fixture).actions)).toEqual([["question", "text", "1"], ["hide"]]);
  await render(page, "text", "active", true);
  await expect(page.getByRole("button", { name: "Show question 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "End round", exact: true })).toBeDisabled();
});

test("host image labels, hover zoom, and sorting answer order use supplied round data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await render(page, "image", "scheduled");
  const images = page.getByLabel("Round images").locator("figure");
  await expect(images).toHaveCount(8);
  for (let index = 0; index < 8; index++) await expect(images.nth(index).locator("figcaption")).toHaveText(`Country ${index + 1}`);
  const bounds = await images.evaluateAll((elements) => elements.map((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
  expect(new Set(bounds.slice(0, 4).map((bounds) => bounds.y)).size).toBe(1);
  expect(bounds[4].y).toBeGreaterThan(bounds[0].y);
  const first = images.first();
  await first.hover();
  await first.getByRole("button", { name: "Zoom image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Flag 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close zoomed image", exact: true }).click();
  await render(page, "sorting", "scheduled");
  const rows = page.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li");
  await expect(rows).toHaveCount(8);
  expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-item-id")))).toEqual(["8", "7", "6", "5", "4", "3", "2", "1"]);
  const positions = await rows.evaluateAll((items) => items.map((item) => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })));
  expect(positions[0].x).toBe(positions[3].x);
  expect(positions[4].x).toBeGreaterThan(positions[0].x);
  expect(positions[0].y).toBe(positions[4].y);
  await expect(page.getByRole("button", { name: /^Reorder item/ })).toHaveCount(0);
});

test("host waits for sorting question documents when the private order arrives first", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as Fixture).renderHost("sorting", "scheduled", false, false));
  await expect(page.getByRole("status")).toHaveText("Loading sorting items…");
  await expect(page.getByRole("list", { name: "Sorting order", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Fixture).renderHost("sorting", "scheduled", false, true));
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li")).toHaveCount(8);
});

test("closed rounds switch their header action from grading to answer reveal", async ({ page }) => {
  await setup(page);
  for (const type of ["text", "multi-step", "image", "sorting", "color"]) {
    await page.evaluate((type) => (window as unknown as Fixture).renderHost(type, "closed", false, true, true), type);
    const header = page.getByRole("region", { name: /^Host round:/ }).locator("header");
    const grade = header.getByRole("button", { name: "Grade answers", exact: true });
    await expect(grade).toBeVisible();
    await expect(page.getByRole("button", { name: "Show answers", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry scoring", exact: true })).toHaveCount(0);
    await grade.click();
    await page.evaluate((type) => (window as unknown as Fixture).renderHost(type, "closed", true, true, true), type);
    await expect(grade).toBeDisabled();
    await page.evaluate((type) => (window as unknown as Fixture).renderHost(type, "closed", false, true, false), type);
    await expect(grade).toHaveCount(0);
    await header.getByRole("button", { name: "Show answers", exact: true }).click();
    await header.getByRole("button", { name: "Hide answers", exact: true }).click();
  }
  expect(await page.evaluate(() => (window as unknown as Fixture).actions)).toEqual(
    ["text", "multi-step", "image", "sorting", "color"].flatMap((type) => [["grade", type], ["reveal", type, true], ["reveal", type, false]])
  );
});
