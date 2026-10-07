import type { ColorPackRound } from "@/types/color";
import { parseColorSvg } from "@/lib/media/color-svg";

export async function validateColorFiles(image: Blob, mask: Blob) {
  const loaded: ImageBitmap[] = [];
  try {
    for (const file of [image, mask]) loaded.push(await createImageBitmap(file));
    if (loaded.some((bitmap) => !bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16777216)) throw new Error("Color assets must be at most 16 megapixels.");
    if (loaded[0].width !== loaded[1].width || loaded[0].height !== loaded[1].height) throw new Error("Image and mask dimensions must match.");
  } finally { loaded.forEach((bitmap) => bitmap.close()); }
}

export async function validateColorPackAssets(rounds: Array<{ type: string }>, files: Map<string, Blob>) {
  for (const round of rounds) {
    if (round.type !== "color") continue;
    for (const [index, question] of (round as ColorPackRound).questions.entries()) {
      const image = files.get(question.image);
      if (!image) throw new Error(`Color question ${index + 1}: missing image.`);
      try {
        if (question.regionIds) parseColorSvg(await image.text(), question.regionIds);
        else {
          const mask = files.get(question.mask);
          if (!mask) throw new Error("Missing mask.");
          await validateColorFiles(image, mask);
        }
      }
      catch (error) { throw new Error(`Color question ${index + 1}: ${(error as Error).message}`); }
    }
  }
}
