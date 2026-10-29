import assert from "node:assert/strict";
import test from "node:test";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { ADMIN_SESSION_COOKIE, adminCookie, assertSameOrigin, establishAdminSession, verifyAdminSession } from "./sessions";

test("admin mutations require the exact same origin", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("https://quiz.test/api/auth/admin/session", { headers: { origin: "https://quiz.test", "sec-fetch-site": "same-origin" } })));
  const disallowed: Array<Record<string, string>> = [{}, { origin: "https://evil.test" }, { origin: "https://quiz.test", "sec-fetch-site": "cross-site" }, { origin: "https://quiz.test", "sec-fetch-site": "same-site" }];
  for (const headers of disallowed) {
    assert.throws(() => assertSameOrigin(new Request("https://quiz.test/api/auth/admin/session", { headers })));
  }
});

test("admin cookies never consume the gameplay session cookie", () => {
  const request = new Request("https://quiz.test", { headers: { cookie: `__session=gameplay; ${ADMIN_SESSION_COOKIE}=admin-token` } });
  assert.equal(adminCookie(request), "admin-token");
  assert.equal(adminCookie(new Request("https://quiz.test", { headers: { cookie: "__session=gameplay" } })), null);
});

test("session validation checks revocation and refuses anonymous/provider-unverified identities", async () => {
  const token = { uid: "google-user", email: "test@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } } as DecodedIdToken;
  let checkRevoked: boolean | undefined;
  const auth = { verifySessionCookie: async (_cookie: string, revoked?: boolean) => { checkRevoked = revoked; return token; } } as Auth;
  assert.equal((await verifyAdminSession(auth, "cookie")).uid, token.uid);
  assert.equal(checkRevoked, true);
  await assert.rejects(verifyAdminSession(auth, null));
  token.firebase.sign_in_provider = "anonymous";
  await assert.rejects(verifyAdminSession(auth, "cookie"));
  token.firebase.sign_in_provider = "google.com"; token.email_verified = false;
  await assert.rejects(verifyAdminSession(auth, "cookie"));
});

test("session establishment refuses stale authentication before writing a directory record", async () => {
  const token = { uid: "google-user", email: "test@example.com", email_verified: true, auth_time: Date.now() / 1000 - 301,
    firebase: { sign_in_provider: "google.com" } } as DecodedIdToken;
  const auth = { verifyIdToken: async () => token } as unknown as Auth;
  await assert.rejects(establishAdminSession(auth, {} as Firestore, "token"), /fresh administrator session/);
});
