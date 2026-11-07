import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("hiding a panel view pauses its media while keeping its mounted response", async ({ page }) => {
  await page.goto("/build");
  await expect(page.getByRole("button", { name: "Add round", exact: true })).toBeVisible();
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  await page.route("**/__interactive-visibility", (route) => route.fulfill({ contentType: "text/html", body: `<html><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body><main style="height:400px;width:760px"></main></body></html>` }));
  await page.goto("/__interactive-visibility");
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import RoomInteractivePanel from './app/[room]/room-interactive-panel';
      const wav = new Uint8Array(44 + 8000 * 2 * 20);
      const data = new DataView(wav.buffer);
      const text = (offset,value) => [...value].forEach((char,index) => data.setUint8(offset+index,char.charCodeAt(0)));
      text(0,'RIFF');data.setUint32(4,wav.length-8,true);text(8,'WAVE');text(12,'fmt ');
      data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);
      data.setUint32(24,8000,true);data.setUint32(28,16000,true);data.setUint16(32,2,true);data.setUint16(34,16,true);
      text(36,'data');data.setUint32(40,wav.length-44,true);
      const src = URL.createObjectURL(new Blob([wav], {type:'audio/wav'}));
      function MediaView({name}) {
        const audio=useRef(null),video=useRef(null);
        const [answer,setAnswer]=useState('');
        return <section aria-label={name} className="space-y-4 p-4">
          <input aria-label={name+' response'} value={answer} onChange={event=>setAnswer(event.target.value)}/>
          <audio aria-label={name+' audio'} ref={audio} src={src} controls loop />
          <video aria-label={name+' video'} ref={video} src={src} controls loop className="h-12" />
          <button type="button" onClick={()=>{audio.current.play();video.current.play();}}>Play {name} media</button>
        </section>;
      }
      createRoot(document.querySelector('main')).render(<RoomInteractivePanel rounds={[{id:'sorting',title:'Media round',roundNumber:1,type:'sorting'}]}
        chat={<MediaView name="Chat"/>} renderRound={()=> <MediaView name="Round"/>} />);
    ` },
    bundle: true, write: false, jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const roundButton = page.getByRole("button", { name: "Round 1: Media round", exact: true });
  const chatButton = page.getByRole("button", { name: "Chat", exact: true });
  const round = page.getByRole("region", { name: "Round", exact: true });
  const chat = page.getByRole("region", { name: "Chat", exact: true });
  const paused = (name: string) => page.locator(`audio[aria-label="${name} audio"],video[aria-label="${name} video"]`).evaluateAll((elements) => elements.map((element) => (element as HTMLMediaElement).paused));

  await roundButton.click();
  await round.getByRole("textbox", { name: "Round response", exact: true }).fill("Keep this order");
  await round.getByRole("button", { name: "Play Round media", exact: true }).click();
  await expect.poll(() => paused("Round")).toEqual([false, false]);
  await chatButton.click();
  await expect.poll(() => paused("Round")).toEqual([true, true]);
  await expect(round).toBeHidden();

  await chat.getByRole("button", { name: "Play Chat media", exact: true }).click();
  await expect.poll(() => paused("Chat")).toEqual([false, false]);
  await roundButton.click();
  await expect.poll(() => paused("Chat")).toEqual([true, true]);
  await expect(round.getByRole("textbox", { name: "Round response", exact: true })).toHaveValue("Keep this order");
  await expect.poll(() => paused("Round")).toEqual([true, true]);
});
