"use client";

import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { getFirebaseClientApp } from "@/lib/firebase/client";

export type ColorArtwork = { image: ImageData; mask: ImageData };

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

export async function loadColorArtwork(imageUrl: string, maskUrl: string): Promise<ColorArtwork> {
  const [image, mask] = await Promise.all([readImage(imageUrl), readImage(maskUrl)]);
  if (image.width !== mask.width || image.height !== mask.height) throw new Error("Image and mask dimensions must match.");
  return { image, mask };
}

type CacheEntry = { promise: Promise<ColorArtwork>; artwork?: ColorArtwork };

export class ColorArtworkCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly loader: (image: string, mask: string) => Promise<ColorArtwork>, private readonly maxBytes = 64 * 1024 * 1024) {}

  private key(room: string, image: string, mask: string) { return JSON.stringify([room, image, mask]); }

  get(room: string, image: string, mask: string): ColorArtwork | undefined {
    const key = this.key(room, image, mask), entry = this.entries.get(key);
    if (!entry?.artwork) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.artwork;
  }

  load(room: string, image: string, mask: string): Promise<ColorArtwork> {
    const key = this.key(room, image, mask), existing = this.entries.get(key);
    if (existing) return existing.promise;
    const entry: CacheEntry = { promise: Promise.resolve().then(() => this.loader(image, mask)) };
    this.entries.set(key, entry);
    entry.promise = entry.promise.then((artwork) => {
      entry.artwork = artwork;
      // Keep decoded pixel buffers bounded; mounted views retain their own artwork.
      let bytes = [...this.entries.values()].reduce((sum, item) => sum + (item.artwork ? item.artwork.image.data.byteLength + item.artwork.mask.data.byteLength : 0), 0);
      for (const [oldKey, oldEntry] of this.entries) {
        if (bytes <= this.maxBytes) break;
        if (!oldEntry.artwork) continue;
        bytes -= oldEntry.artwork.image.data.byteLength + oldEntry.artwork.mask.data.byteLength;
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

export const roomColorArtwork = new ColorArtworkCache(async (image, mask) => {
  const storage = getStorage(getFirebaseClientApp());
  const [imageUrl, maskUrl] = await Promise.all([image, mask].map((path) => getDownloadURL(ref(storage, path))));
  return loadColorArtwork(imageUrl, maskUrl);
});
