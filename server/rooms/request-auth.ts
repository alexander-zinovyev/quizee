import { getServerAuth } from "@/server/database";

export async function requestUserId(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  try {
    return (await getServerAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}
