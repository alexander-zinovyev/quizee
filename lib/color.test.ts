import assert from "node:assert/strict";
import { hexToHsv, hsvToHex, recolorPixels } from "./color";

for (const hex of ["#FFFFFF", "#000000", "#4285F4", "#FF0000", "#00FF00", "#0000FF", "#123ABC"]) assert.equal(hsvToHex(hexToHsv(hex)), hex);
assert.equal(hsvToHex({ h: 360, s: 100, v: 100 }), "#FF0000");
assert.throws(() => hexToHsv("red"));
const image = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 128, 10, 20, 30, 255]);
const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
const result = recolorPixels(image, mask, "#FF0000");
assert.deepEqual([...result.slice(0, 4)], [10, 20, 30, 255]);
assert.deepEqual([...result.slice(4, 8)], [255, 0, 0, 128]);
assert.deepEqual([...result.slice(8)], [133, 10, 15, 255]);
assert.equal(image[4], 10);
assert.throws(() => recolorPixels(image, mask.slice(4), "#FF0000"));
