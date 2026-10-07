import { useEffect, useState } from "react";
import { roomColorArtwork, type ColorArtwork } from "@/lib/media/color-artwork";

export function useRoomColorArtwork(room: string, image?: string, mask?: string, regionIds?: string[]) {
  const key = JSON.stringify([room, image, mask, regionIds]);
  const [state, setState] = useState<{ key: string; artwork?: ColorArtwork; error?: string } | null>(null);
  useEffect(() => {
    if (!image || (!mask && !regionIds?.length)) return;
    let cancelled = false;
    roomColorArtwork.load(room, image, mask, regionIds).then((artwork) => {
      if (!cancelled) setState({ key, artwork });
    }).catch((error: Error) => { if (!cancelled) setState({ key, error: error.message }); });
    return () => { cancelled = true; };
  }, [room, image, mask, key, regionIds]);
  if (state?.key === key) return state;
  const cached = image ? roomColorArtwork.get(room, image, mask, regionIds) : undefined;
  return cached ? { key, artwork: cached } : null;
}
