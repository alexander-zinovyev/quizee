export function moqBroadcastName(roomId: string, userId: string): string {
  return `${roomId}/${encodeURIComponent(userId)}.hang`;
}

export function moqRelayRoot(relayUrl: string): string {
  const url = new URL(relayUrl);
  return url.pathname.replace(/^\/+|\/+$/g, "");
}
