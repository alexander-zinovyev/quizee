import { HEX_COLOR } from "@/types/color";

export type HSV = { h: number; s: number; v: number };

export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX_COLOR.test(hex)) throw new Error("Expected a six-digit HEX color.");
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function hexToHsv(hex: string): HSV {
  const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max * 100 : 0, v: max * 100 };
}

export function hsvToHex({ h, s, v }: HSV): string {
  if (![h, s, v].every(Number.isFinite) || h < 0 || h > 360 || s < 0 || s > 100 || v < 0 || v > 100) throw new Error("Invalid HSV color.");
  const c = v / 100 * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v / 100 - c;
  const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + channels.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function recolorPixels(image: Uint8ClampedArray, mask: Uint8ClampedArray, hex: string): Uint8ClampedArray<ArrayBuffer> {
  if (image.length !== mask.length || image.length % 4) throw new Error("Image and mask dimensions must match.");
  const rgb = hexToRgb(hex);
  const output = new Uint8ClampedArray(image);
  for (let pixel = 0; pixel < image.length; pixel += 4) {
    const weight = (mask[pixel] + mask[pixel + 1] + mask[pixel + 2]) / (3 * 255) * mask[pixel + 3] / 255;
    for (let channel = 0; channel < 3; channel++) output[pixel + channel] = image[pixel + channel] * (1 - weight) + rgb[channel] * weight;
  }
  return output;
}
