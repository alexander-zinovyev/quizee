import type { MediaTransport } from "./transport";
import { DailyTransport } from "./daily-transport";
import { LocalTransport } from "./local-transport";
import { MoqTransport } from "./moq-transport";

export function createMediaTransport(): MediaTransport {
  const transport = process.env.NEXT_PUBLIC_MEDIA_TRANSPORT?.toLowerCase();
  if (transport === "local") {
    return new LocalTransport();
  }
  if (transport === "moq") {
    return new MoqTransport();
  }
  return new DailyTransport();
}
