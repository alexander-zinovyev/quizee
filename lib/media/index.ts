import type { MediaTransport } from "./transport";
import { DailyTransport } from "./daily-transport";

export function createMediaTransport(): MediaTransport {
  return new DailyTransport();
}

