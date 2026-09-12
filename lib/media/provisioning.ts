import { configuredMediaTransport, type MediaTransportKind } from "./config";
import { noopProvisionRoom, type MediaTransportProvider } from "./provider";
import type { MediaTransport } from "./transport";

const DAILY_ROOM_API = "https://api.daily.co/v1/rooms";

class DailyServerProvider implements MediaTransportProvider {
  createClientTransport(): MediaTransport {
    throw new Error("Client media transports cannot be created on the server.");
  }

  async provisionRoom(roomId: string): Promise<void> {
    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) {
      throw new Error("Daily API key is not configured.");
    }

    const response = await fetch(DAILY_ROOM_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: roomId,
        privacy: "private",
        properties: {
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        },
      }),
    });

    if (response.ok || response.status === 409) {
      return;
    }

    const payload = await response.json().catch(() => ({}));
    const message =
      typeof payload?.info === "string" && payload.info.length
        ? payload.info
        : "Unable to create media room.";
    throw new Error(message);
  }
}

class NoopServerProvider implements MediaTransportProvider {
  createClientTransport(): MediaTransport {
    throw new Error("Client media transports cannot be created on the server.");
  }

  provisionRoom = noopProvisionRoom;
}

export function createServerMediaProvider(
  transport: MediaTransportKind = configuredMediaTransport()
): MediaTransportProvider {
  if (transport === "daily") {
    return new DailyServerProvider();
  }

  return new NoopServerProvider();
}
