export function encodeBoundCursor(binding: string, values: Array<string | number>): string {
  return Buffer.from(JSON.stringify({ version: 1, binding, values })).toString("base64url");
}

export function decodeBoundCursor(cursor: string, binding: string): unknown[] {
  if (typeof cursor !== "string" || !cursor || cursor.length > 16000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid statistics cursor.");
  let decoded: { version?: unknown; binding?: unknown; values?: unknown };
  try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
  catch { throw new Error("Invalid statistics cursor."); }
  if (!decoded || decoded.version !== 1 || decoded.binding !== binding || !Array.isArray(decoded.values)) throw new Error("Cursor does not match this statistics query.");
  return decoded.values;
}
