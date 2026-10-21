export async function readJsonResponse<T>(response: Response, action: string): Promise<T> {
  const failure = `${action} failed (HTTP ${response.status})`;
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new Error(`${failure}: expected JSON but received ${contentType || "an unknown response type"}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${failure}: the server returned invalid JSON.`);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      && typeof payload.message === "string" ? payload.message.trim() : "";
    throw new Error(message ? `${failure}: ${message}` : `${failure}.`);
  }
  return payload as T;
}
