import assert from "node:assert/strict";
import { ColorArtworkCache, type ColorArtwork } from "./color-artwork";
import { parseColorSvg } from "./color-svg";

function artwork(): ColorArtwork {
  return { image: { data: new Uint8ClampedArray(16), width: 2, height: 2 } as ImageData,
    mask: { data: new Uint8ClampedArray(16), width: 2, height: 2 } as ImageData };
}

async function main() {
  let calls = 0;
  let resolve!: (value: ColorArtwork) => void;
  const cache = new ColorArtworkCache(async () => { calls++; return new Promise((done) => { resolve = done; }); });
  const preloaded = cache.load("room", "image", "mask");
  const presented = cache.load("room", "image", "mask");
  assert.equal(preloaded, presented);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(cache.get("room", "image", "mask"), undefined);
  const pixels = artwork();
  resolve(pixels);
  await preloaded;
  assert.equal(cache.get("room", "image", "mask"), pixels);
  assert.equal(await cache.load("room", "image", "mask"), pixels);
  assert.equal(calls, 1);
  assert.equal(cache.get("other-room", "image", "mask"), undefined);
  const bounded = new ColorArtworkCache(async () => artwork(), 32);
  await bounded.load("room", "image-1", "mask");
  await bounded.load("room", "image-2", "mask");
  assert.equal(bounded.get("room", "image-1", "mask"), undefined);
  assert.ok(bounded.get("room", "image-2", "mask"));
  const invalid = new ColorArtworkCache(async () => { throw new Error("Invalid asset"); });
  await assert.rejects(invalid.load("room", "image", "mask"), /Invalid asset/);
  assert.equal(invalid.get("room", "image", "mask"), undefined);
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="left" width="5" height="10" fill="#FFFFFF"/><rect id="right" x="5" width="5" height="10" fill="#FFFFFF"/></svg>';
  let svgLoads = 0;
  const vectors = new ColorArtworkCache(async (_image, _mask, regions) => { svgLoads++; return parseColorSvg(source, regions); });
  const left = await vectors.load("room", "logo.svg", undefined, ["left"]);
  const right = await vectors.load("room", "logo.svg", undefined, ["right"]);
  assert.notEqual(left, right);
  assert.equal(await vectors.load("room", "logo.svg", undefined, ["left"]), left);
  assert.equal(svgLoads, 2);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
