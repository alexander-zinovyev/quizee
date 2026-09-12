import type { MediaTransport } from "./transport";

export interface MediaTransportProvider {
  createClientTransport(): MediaTransport;
  provisionRoom(roomId: string): Promise<void>;
}

export async function noopProvisionRoom(): Promise<void> {
  return;
}
