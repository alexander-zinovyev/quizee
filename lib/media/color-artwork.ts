"use client";

import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseClientApp } from "@/lib/firebase/client";
import { parseColorSvg, type ColorSvg } from "./color-svg";

export type RasterColorArtwork = { kind?: "raster"; image: ImageData; mask: ImageData };
export type ColorArtwork = RasterColorArtwork | ColorSvg;

async function readImage(url: string): Promise<ImageData> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16777216) throw new Error("Color image is empty or exceeds 16 megapixels.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function loadColorArtwork(imageUrl: string, maskUrl?: string, regionIds?: string[]): Promise<ColorArtwork> {
  if (regionIds) {
    if (maskUrl) throw new Error("SVG artwork cannot have a raster mask.");
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Unable to load SVG artwork.");
    return parseColorSvg(await response.text(), regionIds);
  }
  if (!maskUrl) throw new Error("Raster artwork requires a mask.");
  const [image, mask] = await Promise.all([readImage(imageUrl), readImage(maskUrl)]);
  if (image.width !== mask.width || image.height !== mask.height) throw new Error("Image and mask dimensions must match.");
  return { image, mask };
}

type CacheEntry = { promise: Promise<ColorArtwork>; artwork?: ColorArtwork };

export class ColorArtworkCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly loader: (image: string, mask?: string, regionIds?: string[]) => Promise<ColorArtwork>, private readonly maxBytes = 64 * 1024 * 1024) {}

  private key(room: string, image: string, mask?: string, regionIds?: string[]) { return JSON.stringify([room, image, mask, regionIds]); }
  private size(artwork: ColorArtwork) { return artwork.kind === "svg" ? new TextEncoder().encode(JSON.stringify(artwork)).byteLength : artwork.image.data.byteLength + artwork.mask.data.byteLength; }

  get(room: string, image: string, mask?: string, regionIds?: string[]): ColorArtwork | undefined {
    const key = this.key(room, image, mask, regionIds), entry = this.entries.get(key);
    if (!entry?.artwork) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.artwork;
  }

  load(room: string, image: string, mask?: string, regionIds?: string[]): Promise<ColorArtwork> {
    const key = this.key(room, image, mask, regionIds), existing = this.entries.get(key);
    if (existing) return existing.promise;
    const entry: CacheEntry = { promise: Promise.resolve().then(() => this.loader(image, mask, regionIds)) };
    this.entries.set(key, entry);
    entry.promise = entry.promise.then((artwork) => {
      entry.artwork = artwork;
      // Keep decoded pixel buffers bounded; mounted views retain their own artwork.
      let bytes = [...this.entries.values()].reduce((sum, item) => sum + (item.artwork ? this.size(item.artwork) : 0), 0);
      for (const [oldKey, oldEntry] of this.entries) {
        if (bytes <= this.maxBytes) break;
        if (!oldEntry.artwork) continue;
        bytes -= this.size(oldEntry.artwork);
        this.entries.delete(oldKey);
      }
      return artwork;
    }).catch((error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    return entry.promise;
  }
}

export const roomColorArtwork = new ColorArtworkCache(async (image, mask, regionIds) => {
  const storage = getStorage(getFirebaseClientApp());
  const [imageUrl, maskUrl] = await Promise.all([image, ...(mask ? [mask] : [])].map((path) => getDownloadURL(ref(storage, path))));
  return loadColorArtwork(imageUrl, maskUrl, regionIds);
});
