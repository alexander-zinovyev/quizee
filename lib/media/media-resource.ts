export type MediaResource = { url: string; isBlob: boolean };

/** Cache readable bytes locally; native media can also display URLs that forbid script access. */
export async function loadMediaResource(url: string, signal?: AbortSignal): Promise<MediaResource> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof TypeError) return { url, isBlob: false };
    throw error;
  }
  if (!response.ok) throw new Error(`Unable to load media (HTTP ${response.status}).`);
  const blob = await response.blob();
  signal?.throwIfAborted();
  return { url: URL.createObjectURL(blob), isBlob: true };
}

export function releaseMediaResource(resource: MediaResource) {
  if (resource.isBlob) URL.revokeObjectURL(resource.url);
}
