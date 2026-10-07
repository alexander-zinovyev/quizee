import sharp from "sharp";

export async function validateColorAssets(image: Buffer, mask: Buffer) {
  const dimensions = await Promise.all([image, mask].map(async (bytes) => {
    const metadata = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 ||
        !metadata.width || !metadata.height || metadata.width * metadata.height > 16777216) {
      throw new Error("Color assets must be static raster images of at most 16 megapixels.");
    }
    return (metadata.orientation ?? 1) >= 5
      ? { width: metadata.height, height: metadata.width }
      : { width: metadata.width, height: metadata.height };
  }));
  if (dimensions[0].width !== dimensions[1].width || dimensions[0].height !== dimensions[1].height) throw new Error("Color image and mask dimensions must match.");
}
