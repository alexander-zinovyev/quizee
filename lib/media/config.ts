export const DEFAULT_MEDIA_TRANSPORT = "daily";

export type MediaTransportKind = "daily" | "local" | "moq";

export function configuredMediaTransport(
  value = process.env.NEXT_PUBLIC_MEDIA_TRANSPORT
): MediaTransportKind {
  if (!value) {
    return DEFAULT_MEDIA_TRANSPORT;
  }

  const transport = value.toLowerCase();
  if (transport === "daily" || transport === "local" || transport === "moq") {
    return transport;
  }

  throw new Error(`Unsupported media transport "${value}".`);
}
