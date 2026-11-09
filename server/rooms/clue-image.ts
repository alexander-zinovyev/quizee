import sharp from "sharp";

/** Rasterize private images once; never serve authored SVG markup or inherited download tokens. */
export async function prepareClueImage(bytes: Buffer): Promise<Buffer> {
  const image = sharp(bytes, { limitInputPixels: 16777216 });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "gif", "webp", "svg"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) {
    throw new Error("Clue images must be static images of at most 16 megapixels.");
  }
  return image.rotate().png().toBuffer();
}
