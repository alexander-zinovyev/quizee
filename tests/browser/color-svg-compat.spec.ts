import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const names = ["harley", "jurassic", "mastercard", "mcdonalds", "olympic", "playstation", "redbull", "slack"];

type SvgHarness = Window & {
  svgSources: Record<string, string>;
  svgInfo: Record<string, { width: number; height: number; viewBox: string; selected: string }>;
  renderLogos: (recolor: boolean) => void;
};

for (const width of [1440, 390]) test(`third-party SVG appearance and recoloring at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route("**/__svg-compat", (route) => route.fulfill({ contentType: "text/html", body: '<html><head><style>body{margin:16px;background:white;color:#111;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}figure{margin:0;min-width:0}figcaption{margin-bottom:8px}svg{display:block;width:100%;height:auto}@media(max-width:700px){main{grid-template-columns:1fr}}</style></head><body><div id="logos"></div></body></html>' }));
  await page.goto("/__svg-compat");
  const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(`tests/fixtures/color-svg/${name}.svg`, "utf8")])));
  await page.evaluate((sources) => { (window as unknown as SvgHarness).svgSources = sources; }, sources);
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { parseColorSvg } from './lib/media/color-svg';
      import { ColorSvgImage } from './lib/components/color-svg';
      const root = createRoot(document.getElementById('logos'));
      const artworks = Object.fromEntries(Object.entries(window.svgSources).map(([name, source]) => [name, parseColorSvg(source)]));
      window.svgInfo = {};
      function blueRing(node, artwork) {
        if (node.tag === 'g' && node.attributes.stroke === '#0085c7' && artwork.regionPaints[node.attributes.id] === 'stroke') return node.attributes.id;
        for (const child of node.children) { const id = blueRing(child, artwork); if (id) return id; }
      }
      for (const [name, artwork] of Object.entries(artworks)) window.svgInfo[name] = { width: artwork.width, height: artwork.height, viewBox: artwork.root.attributes.viewBox,
        selected: name === 'olympic' ? blueRing(artwork.root, artwork) : artwork.eligibleRegionIds[0] };
      window.renderLogos = recolor => root.render(<main>{Object.entries(artworks).map(([name, artwork]) => <figure key={name}>
        <figcaption>{name}</figcaption><ColorSvgImage artwork={{...artwork, regionIds: [window.svgInfo[name].selected]}} color="#D12CE5" original={!recolor} label={name} className="logo" />
      </figure>)}</main>);
      window.renderLogos(false);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole("img")).toHaveCount(8);
  await expect(page.getByRole("img", { name: "playstation", exact: true })).toHaveCSS("overflow", "hidden");
  const original = await page.evaluate(async () => {
    const w = window as unknown as SvgHarness;
    const results: Record<string, { difference: number; painted: number }> = {};
    for (const [name, source] of Object.entries(w.svgSources)) {
      const info = w.svgInfo[name];
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      document.documentElement.setAttribute("viewBox", info.viewBox);
      const actual = window.document.querySelector(`svg[aria-label="${name}"]`)!.cloneNode(true) as SVGSVGElement;
      const pixels = async (root: Element) => {
        root.setAttribute("width", String(info.width)); root.setAttribute("height", String(info.height));
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
        try {
          const image = new Image(); image.src = url; await image.decode();
          const canvas = window.document.createElement("canvas"); canvas.width = 640; canvas.height = Math.round(640 * info.height / info.width);
          const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        } finally { URL.revokeObjectURL(url); }
      };
      const expected = await pixels(document.documentElement), rendered = await pixels(actual);
      let changed = 0, painted = 0;
      for (let index = 0; index < expected.length; index += 4) {
        if (expected[index + 3] || rendered[index + 3]) painted++;
        if ([0, 1, 2, 3].some((offset) => Math.abs(expected[index + offset] - rendered[index + offset]) > 8)) changed++;
      }
      results[name] = { difference: changed / painted, painted };
    }
    return results;
  });
  for (const name of names) {
    expect(original[name].painted, `${name} must be nonblank`).toBeGreaterThan(500);
    expect(original[name].difference, `${name} should retain its appearance`).toBeLessThan(0.01);
  }
  await testInfo.attach("original-render-comparison", { body: JSON.stringify(original, null, 2), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath(`original-logos-${width}.png`), fullPage: true });

  const olympicPalette = () => page.getByRole("img", { name: "olympic", exact: true }).evaluate(async (element) => {
    const copy = element.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("width", "680"); copy.setAttribute("height", "330");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 680; canvas.height = 330;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, 680, 330).data;
      const colors = [[0, 133, 199], [0, 0, 0], [223, 0, 36], [244, 195, 0], [0, 159, 61], [209, 44, 229]];
      const counts = colors.map((color) => {
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255 && color.every((value, channel) => data[i + channel] === value)) count++;
        return count;
      });
      let alphaSum = 0;
      for (let i = 3; i < data.length; i += 4) alphaSum += data[i];
      return { counts, alphaSum };
    } finally { URL.revokeObjectURL(url); }
  });
  const before = await olympicPalette();
  expect(before.counts.slice(0, 5).every((count) => count > 500)).toBe(true);
  await page.evaluate(() => (window as unknown as SvgHarness).renderLogos(true));
  for (const name of names) {
    await expect(page.getByRole("img", { name, exact: true }).locator('[fill="#D12CE5"], [stroke="#D12CE5"]')).not.toHaveCount(0);
  }
  const after = await olympicPalette();
  expect(after.counts[0]).toBe(0);
  expect(Math.abs(after.counts[5] - before.counts[0]) / before.counts[0]).toBeLessThan(0.002);
  for (let index = 1; index < 5; index++) expect(Math.abs(after.counts[index] - before.counts[index]) / before.counts[index]).toBeLessThan(0.002);
  expect(after.alphaSum).toBe(before.alphaSum);
  await page.screenshot({ path: testInfo.outputPath(`recolored-logos-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
