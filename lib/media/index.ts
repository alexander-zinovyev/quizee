import type { MediaTransport } from "./transport";
import { configuredMediaTransport, type MediaTransportKind } from "./config";
import { DailyTransport } from "./daily-transport";
import { LocalTransport } from "./local-transport";
import { MoqTransport } from "./moq-transport";
import { noopProvisionRoom, type MediaTransportProvider } from "./provider";

class DailyClientProvider implements MediaTransportProvider {
  createClientTransport(): MediaTransport {
    return new DailyTransport();
  }

  provisionRoom = noopProvisionRoom;
}

class LocalClientProvider implements MediaTransportProvider {
  createClientTransport(): MediaTransport {
    return new LocalTransport();
  }

  provisionRoom = noopProvisionRoom;
}

class MoqClientProvider implements MediaTransportProvider {
  createClientTransport(): MediaTransport {
    return new MoqTransport();
  }

  provisionRoom = noopProvisionRoom;
}

export function createClientMediaProvider(
  transport: MediaTransportKind = configuredMediaTransport()
): MediaTransportProvider {
  if (transport === "local") {
    return new LocalClientProvider();
  }
  if (transport === "moq") {
    return new MoqClientProvider();
  }
  return new DailyClientProvider();
}

export function createMediaTransport(): MediaTransport {
  return createClientMediaProvider().createClientTransport();
}
