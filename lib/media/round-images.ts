import type { RoundImage } from "@/lib/hooks/use-room-rounds";
import type { ImageItem } from "@/types/quiz";

export const MEDIA_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export function getRoundImageItems(images: RoundImage[], resolveUrl: (path: string) => string | undefined): ImageItem[] {
  return images.flatMap((image) => image.media?.storagePath ? [{
    id: image.id,
    src: resolveUrl(image.media.storagePath) ?? MEDIA_PLACEHOLDER,
    alt: image.media.filename ?? image.media.originalPath ?? "Quiz image",
  }] : []);
}
