import type { MediaTransport } from "./transport";
import { DailyTransport } from "./daily-transport";
import { LocalTransport } from "./local-transport";

export function createMediaTransport(): MediaTransport {
  if (process.env.NEXT_PUBLIC_MEDIA_DISABLED === "true") {
    return new LocalTransport();
  }
  return new DailyTransport();
}
