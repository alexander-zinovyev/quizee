import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

async function setup(page: Page) {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__interactive-content", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main></main></body></html>` }));
  await page.goto("/__interactive-content");
  const bundle = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SortingQuestions} from './lib/components/sorting-round';
      import {AnswerInputs} from './lib/components/answer-round';
      import Chat from './lib/components/chat';
      const items = Array.from({length:8}, (_,index) => ({id:String(index),text:'Item '+(index+1)}));
      const questions = [{id:'first'},{id:'second'}];
      window.contentMutations=[];window.contentMessages=[];
      function Harness() {
        const [order,setOrder]=useState(items.map(item => item.id));
        const [answers,setAnswers]=useState({second:{answer:'Locked answer',locked:true,wagered:false,user:'red'}});
        const [chatActive,setChatActive]=useState(true);
        const [messages,setMessages]=useState([]);
        window.appendChatMessages = count => setMessages(previous => [...previous,...Array.from({length:count},(_,index) => ({id:previous.length+index,author:'Player',content:'Message '+(previous.length+index+1)}))]);
        return <div className="space-y-8 p-4">
          <section aria-label="Sorting fixture" className="w-[760px] max-w-full">
            <SortingQuestions layout="columns" items={items} order={order} disabled={false} onMove={(from,to) => setOrder(previous => {
              const next=[...previous];next.splice(to,0,next.splice(from,1)[0]);return next;
            })}/>
          </section>
          <section aria-label="Answer fixture" className="h-[160px] w-[760px] max-w-full">
            <AnswerInputs embedded type="text" roundId="text" questions={questions} allowWager answers={answers} pending={{}} enabled error={null}
              onChange={(id,mutation) => {window.contentMutations.push({id,...mutation});setAnswers(previous => ({...previous,[id]:{answer:'',locked:false,user:'red',...previous[id],...mutation}}));}}/>
          </section>
          <button type="button" onClick={() => setChatActive(previous => !previous)}>{chatActive ? 'Hide chat' : 'Show chat'}</button>
          <section aria-label="Chat fixture" hidden={!chatActive} className="h-[300px] w-[760px] max-w-full border"><Chat embedded active={chatActive} autoSize={false} messages={messages}
            onSend={message => window.contentMessages.push(message)} /></section>
        </div>;
      }
      createRoot(document.querySelector('main')).render(<Harness/>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "interactive-content-transport", setup(builder) {
      builder.onResolve({ filter: /^(@\/lib\/firebase\/client|@\/app\/providers\/firebase-auth-provider)$/ }, (args) => ({ path: args.path, namespace: "content-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "content-mock" }, (args) => ({ contents: args.path.includes("firebase-auth")
        ? `export const useFirebaseAuth=()=>({getToken:async()=>'',user:{uid:'red'}});`
        : `export const getClientFirestore=()=>({}); export const getFirebaseClientApp=()=>({});` }));
    } }],
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole("button", { name: "Reorder item 1", exact: true })).toBeVisible();
}

const order = (page: Page) => page.getByRole("list", { name: "Sorting order", exact: true }).locator(":scope > li").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item-id")));

test("sorting columns preserve numeric order and reorder across their boundary", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await setup(page);
  const list = page.getByRole("list", { name: "Sorting order", exact: true });
  const positions = await list.locator(":scope > li").evaluateAll((rows) => rows.map((row) => ({ left: row.getBoundingClientRect().left, top: row.getBoundingClientRect().top, text: row.textContent })));
  expect(positions[0].left).toBe(positions[3].left);
  expect(positions[4].left).toBeGreaterThan(positions[0].left);
  expect(positions[4].top).toBe(positions[0].top);
  expect(positions[7].top).toBe(positions[3].top);
  expect(positions.map((position) => position.text)).toEqual(Array.from({ length: 8 }, (_, index) => `${index + 1}.Item ${index + 1}`));
  await expect(list.locator('img[src="/interactive-panel/drag.svg"]')).toHaveCount(8);
  await expect.poll(() => list.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth === 12 && (image as HTMLImageElement).naturalHeight === 20))).toBe(true);

  const fourth = list.getByRole("button", { name: "Reorder item 4", exact: true });
  await fourth.focus();
  await page.keyboard.press("Space");
  await expect(fourth).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[aria-live="assertive"]')).toHaveText("Over position 4.");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[aria-live="assertive"]')).toHaveText("Over position 5.");
  await page.keyboard.press("Space");
  await expect.poll(() => order(page)).toEqual(["0", "1", "2", "4", "3", "5", "6", "7"]);

  const source = list.locator('[data-item-id="0"]');
  const target = list.locator('[data-item-id="7"]');
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 70, from.y + from.height / 2);
  await expect(source.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["1", "2", "4", "3", "5", "6", "7", "0"]);
  await list.screenshot({ path: testInfo.outputPath("sorting-columns.png") });
});

test("embedded answer inputs preserve wagers and lock/edit behavior", async ({ page }) => {
  await setup(page);
  const region = page.getByRole("region", { name: "Answer fixture", exact: true });
  await region.getByRole("textbox", { name: "Answer 1", exact: true }).fill("Paris");
  await region.getByRole("button", { name: "Double or nothing for answer 1", exact: true }).click();
  await expect(region.getByRole("button", { name: "Double or nothing for answer 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await region.getByTitle("Lock answer", { exact: true }).click();
  await expect(region.getByRole("textbox", { name: "Answer 1", exact: true })).toBeDisabled();
  await expect(region.getByRole("textbox", { name: "Answer 2", exact: true })).toBeDisabled();
  await region.getByTitle("Edit answer", { exact: true }).first().click();
  await expect(region.getByRole("textbox", { name: "Answer 1", exact: true })).toBeEnabled();
  await expect(region.getByRole("textbox", { name: "Answer 1", exact: true })).toHaveValue("Paris");
  await expect(region.locator('img[src="/interactive-panel/check.svg"]')).toHaveCount(1);
  await expect(region.locator('img[src="/interactive-panel/pencil.svg"]')).toHaveCount(1);
});

test("embedded chat keeps its composer and sends messages without a redundant heading", async ({ page }) => {
  await setup(page);
  const region = page.getByRole("region", { name: "Chat fixture", exact: true });
  await expect(region.locator("header")).toHaveCount(0);
  await expect(region.getByRole("log", { name: "Chat messages", exact: true })).toContainText("No chat activity yet.");
  await region.getByRole("textbox", { name: "Message input", exact: true }).fill("Hello team");
  await region.getByRole("button", { name: "Send", exact: true }).click();
  await expect(region.getByRole("textbox", { name: "Message input", exact: true })).toHaveValue("");
  expect(await page.evaluate(() => (window as unknown as { contentMessages: string[] }).contentMessages)).toEqual(["Hello team"]);
});

test("returning to chat scrolls to messages received while hidden and keeps the draft", async ({ page }) => {
  await setup(page);
  const region = page.getByRole("region", { name: "Chat fixture", exact: true });
  const log = region.getByRole("log", { name: "Chat messages", exact: true });
  const append = (count: number) => page.evaluate((value) => (window as unknown as { appendChatMessages: (count: number) => void }).appendChatMessages(value), count);
  const atBottom = () => log.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop < 2);
  await append(30);
  await expect.poll(atBottom).toBe(true);
  await region.getByRole("textbox", { name: "Message input", exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Hide chat", exact: true }).click();
  await append(70);
  await expect(region).toBeHidden();
  await page.getByRole("button", { name: "Show chat", exact: true }).click();
  await expect(log).toContainText("Message 100");
  await expect.poll(atBottom).toBe(true);
  await expect(region.getByRole("textbox", { name: "Message input", exact: true })).toHaveValue("Keep this draft");
});
