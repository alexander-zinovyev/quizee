import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { StatsError } from "./error";
import { statsId } from "./model";

export const ADMIN_SESSION_COOKIE = "__stats_admin";
export const ADMIN_SESSION_MS = 5 * 24 * 60 * 60 * 1000;

export function assertSameOrigin(request: Request): void {
  // Next can construct route URLs with an internal hostname. Match its ingress headers,
  // as Server Actions do, while retaining the exact scheme/host/port origin check.
  const route = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? request.headers.get("host") ?? route.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() ?? route.protocol.slice(0, -1);
  let expected: string | null = null;
  if (["http", "https"].includes(protocol) && host && !/[\s/@?#\\]/.test(host)) {
    try { expected = new URL(`${protocol}://${host}`).origin; } catch { /* Refuse malformed ingress metadata below. */ }
  }
  if (!expected || request.headers.get("origin") !== expected ||
      ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
    throw new StatsError("invalid-origin", "This action requires a request from this site.", 403);
  }
}

export function adminCookie(request: Request): string | null {
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  return value ? value.slice(ADMIN_SESSION_COOKIE.length + 1) : null;
}

function googleIdentity(token: DecodedIdToken): void {
  if (token.firebase?.sign_in_provider !== "google.com" || token.email_verified !== true || !token.email) {
    throw new StatsError("google-required", "Sign in with a verified Google account.", 403);
  }
  if (token.uid === "_state") throw new StatsError("invalid-user", "This account cannot be used for administration.", 403);
  statsId(token.uid);
}

export async function verifyAdminSession(auth: Auth, cookie: string | null): Promise<DecodedIdToken> {
  if (!cookie) throw new StatsError("unauthenticated", "Sign in to continue.", 401);
  let token: DecodedIdToken;
  try { token = await auth.verifySessionCookie(cookie, true); }
  catch { throw new StatsError("unauthenticated", "Your session expired. Sign in again.", 401); }
  googleIdentity(token);
  return token;
}

export async function establishAdminSession(auth: Auth, db: Firestore, idToken: string) {
  let token: DecodedIdToken;
  try { token = await auth.verifyIdToken(idToken, true); }
  catch { throw new StatsError("unauthenticated", "Sign in again to establish an administrator session.", 401); }
  googleIdentity(token);
  const now = Date.now() / 1000;
  if (!Number.isFinite(token.auth_time) || token.auth_time > now + 60 || now - token.auth_time > 300) {
    throw new StatsError("recent-login-required", "Sign in again to establish a fresh administrator session.", 401);
  }
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: ADMIN_SESSION_MS });
  await db.collection("users").doc(token.uid).set({ uid: token.uid, provider: "google.com", email: token.email!.toLowerCase(),
    emailVerified: true, displayName: typeof token.name === "string" ? token.name : null, lastLoginAt: new Date().toISOString() }, { merge: true });
  return cookie;
}

export async function statsSessionUser(auth: Auth, db: Firestore, cookie: string | null) {
  const token = await verifyAdminSession(auth, cookie);
  const role = await db.collection("roles").doc(token.uid).get();
  return { uid: token.uid, displayName: typeof token.name === "string" ? token.name : null, email: token.email!, admin: role.data()?.admin === true };
}

export async function requireStatsSessionAdmin(auth: Auth, db: Firestore, cookie: string | null): Promise<string> {
  const user = await statsSessionUser(auth, db, cookie);
  if (!user.admin) throw new StatsError("forbidden", "Administrator access has not been granted to this account.", 403);
  return user.uid;
}
