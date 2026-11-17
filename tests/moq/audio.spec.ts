import { expect, test, type Browser, type Page } from "@playwright/test";
import manifest from "../../vendor/moq/manifest.json";

type Metrics = { seconds: number; lowWindows: number; discontinuities: number; encodedSpan: number | null; errors: string[]; configs: { opus?: { usedtx?: boolean } }[] };

async function participant(browser: Browser, role: "publish" | "watch", name: string, options = "") {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); console.error(message.text()); } });
  await page.goto(`http://127.0.0.1:3029/?role=${role}&name=${name}${options}`, { waitUntil: "commit" });
  await page.waitForFunction("window.moqProbe?.ready");
  return { page, errors };
}
async function ready(page: Page) {
  await page.waitForFunction("window.moqProbe.pcm.length > 12 && window.moqProbe.element.audio.out.stats.peek()?.bytesReceived > 5000");
}
async function measure(pages: Page[], mode: string, seconds: number) {
  // Last page is the publisher. Start its new signal after listeners start recording.
  for (const page of pages) await page.evaluate(`window.moqProbe.begin(${JSON.stringify(mode)})`);
  await Promise.all(pages.slice(0, -1).map((page) => page.waitForFunction(`window.moqProbe.seconds() >= ${seconds}`)));
  await Promise.all(pages.map((page) => page.evaluate("window.moqProbe.stop()")));
  return Promise.all(pages.map((page) => page.evaluate<Metrics>("window.moqProbe.metrics()")));
}

test("steady tone survives lossless 60 ms delivery batches", async ({ browser }, info) => {
  const name = `regression-${Date.now()}.hang`;
  const publisher = await participant(browser, "publish", name);
  const listener = await participant(browser, "watch", name, "&burst=60");
  try {
    await ready(listener.page);
    const results = await measure([listener.page, publisher.page], "tone", 16);
    await info.attach("pcm-metrics", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
    for (const result of results) { expect(result.lowWindows).toBe(0); expect(result.discontinuities).toBe(0); expect(result.errors).toEqual([]); }
    expect([...publisher.errors, ...listener.errors]).toEqual([]);
    expect(await listener.page.evaluate((entry) => performance.getEntriesByType("resource").some((resource) => new URL(resource.name).pathname === entry), manifest.entry)).toBe(true);
  } finally { await publisher.page.close(); await listener.page.close(); }
});

test("quiet intervals preserve the publishing timeline", async ({ browser }, info) => {
  const name = `quiet-${Date.now()}.hang`;
  const publisher = await participant(browser, "publish", name);
  const listener = await participant(browser, "watch", name);
  try {
    await ready(listener.page);
    const [received, source] = await measure([listener.page, publisher.page], "quiet", 20);
    await info.attach("pcm-metrics", { body: JSON.stringify({ received, source }, null, 2), contentType: "application/json" });
    expect(source.encodedSpan).not.toBeNull();
    expect(source.configs.length).toBeGreaterThan(0);
    expect(source.seconds - source.encodedSpan!).toBeLessThan(0.2);
    expect(source.configs.every((config) => config.opus?.usedtx !== true)).toBe(true);
    expect(source.lowWindows).toBeGreaterThan(900);
    expect(source.lowWindows).toBeLessThan(1200);
    expect(received.lowWindows).toBeGreaterThan(900);
    expect(received.lowWindows).toBeLessThan(1200);
    expect(received.discontinuities).toBe(0);
    expect([...publisher.errors, ...listener.errors, ...received.errors]).toEqual([]);
  } finally { await publisher.page.close(); await listener.page.close(); }
});

test("six remote listeners receive continuous audio", async ({ browser }, info) => {
  const name = `room-${Date.now()}.hang`;
  const publisher = await participant(browser, "publish", name);
  const listeners = await Promise.all(Array.from({ length: 6 }, () => participant(browser, "watch", name)));
  try {
    await Promise.all(listeners.map(({ page }) => ready(page)));
    const results = await measure([...listeners.map(({ page }) => page), publisher.page], "tone", 16);
    await info.attach("pcm-metrics", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
    for (const result of results) { expect(result.lowWindows).toBe(0); expect(result.discontinuities).toBe(0); }
    expect([publisher, ...listeners].flatMap((client) => client.errors)).toEqual([]);
  } finally { await Promise.all([publisher, ...listeners].map(({ page }) => page.close())); }
});

test("codec fallback loads the self-hosted worker and wasm", async ({ browser }) => {
  const name = `fallback-${Date.now()}.hang`;
  const publisher = await participant(browser, "publish", name, "&polyfill");
  const listener = await participant(browser, "watch", name, "&polyfill");
  try {
    await ready(listener.page);
    const [received, source] = await measure([listener.page, publisher.page], "tone", 8);
    expect(source.lowWindows).toBe(0);
    expect(received.lowWindows).toBe(0);
    expect(received.discontinuities).toBe(0);
    expect([...publisher.errors, ...listener.errors]).toEqual([]);
  } finally { await publisher.page.close(); await listener.page.close(); }
});

test("member controls update the real publishing and playback elements", async ({ browser }) => {
  const name = `controls-${Date.now()}.hang`;
  const publisher = await participant(browser, "publish", name);
  const listener = await participant(browser, "watch", name);
  try {
    await ready(listener.page);
    await publisher.page.getByRole("button", { name: "Turn microphone off" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(publisher.page.locator("moq-publish")).toHaveJSProperty("muted", true);
    await publisher.page.getByRole("button", { name: "Turn microphone on" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(publisher.page.locator("moq-publish")).toHaveJSProperty("muted", false);
    await publisher.page.getByRole("button", { name: "Turn camera on" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(publisher.page.locator("moq-publish")).toHaveJSProperty("invisible", false);
    await listener.page.evaluate("window.moqProbe.setPolicy(true, true)");
    await publisher.page.waitForFunction("window.moqProbe.element.video.out.stats.peek()?.frames > 0");
    await listener.page.waitForFunction("window.moqProbe.element.video.out.stats.peek()?.frameCount > 0");
    await publisher.page.getByRole("button", { name: "Turn camera off" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(publisher.page.locator("moq-publish")).toHaveJSProperty("invisible", true);
    await listener.page.getByRole("button", { name: "Mute playback" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("muted", true);
    await listener.page.getByRole("button", { name: "Unmute playback" }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("muted", false);
    await listener.page.getByRole("slider", { name: "Volume" }).evaluate((slider: HTMLInputElement) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(slider, "0.3"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("volume", 0.3);
    await listener.page.evaluate("window.moqProbe.setPolicy(false, false)");
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("muted", true);
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("visible", "never");
    await listener.page.evaluate("window.moqProbe.setPolicy(true, true); window.moqProbe.forceMute(true)");
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("muted", true);
    await expect(listener.page.locator("moq-watch")).toHaveJSProperty("visible", "always");
    expect([...publisher.errors, ...listener.errors]).toEqual([]);
  } finally { await publisher.page.close(); await listener.page.close(); }
});

test("a missing browser module is visible to the member", async ({ page }) => {
  await page.route(`**${manifest.entry}`, (route) => route.fulfill({ status: 404, body: "Missing asset" }));
  await page.goto("http://127.0.0.1:3029/?role=watch&name=missing.hang", { waitUntil: "commit" });
  await expect(page.getByRole("alert")).toHaveText("Unable to load the MoQ media module.");
});
