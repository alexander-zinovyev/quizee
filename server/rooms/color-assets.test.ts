import assert from "node:assert/strict";
import sharp from "sharp";
import { validateColorAssets } from "./color-assets";

async function main() {
  const image = await sharp({ create: { width: 32, height: 16, channels: 4, background: "#4285F4" } }).png().toBuffer();
  const mask = await sharp({ create: { width: 16, height: 16, channels: 4, background: "white" } }).png().toBuffer();
  await validateColorAssets(image, image);
  await assert.rejects(validateColorAssets(image, mask), /dimensions must match/);
  await assert.rejects(validateColorAssets(image, Buffer.from("invalid image")));
  const rotated = await sharp({ create: { width: 16, height: 32, channels: 3, background: "blue" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  await validateColorAssets(image, rotated);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
