import { randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { assertStatsAdmin } from "./authorization";
import { StatsError } from "./error";
import { statsId, statsPaths } from "./model";

function targetUid(uid: string) {
  if (uid === "_state") throw new StatsError("invalid-user", "Reserved account ID.", 422);
  try { return statsId(uid); }
  catch { throw new StatsError("invalid-user", "Invalid account UID.", 422); }
}

export async function lookupAdminUsers(db: Firestore, actorId: string, search: string) {
  if (!search.trim() || search.length > 320) throw new StatsError("invalid-search", "Enter an exact signed-in user UID or email address.", 400);
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const users = db.collection("users");
    const validUid = search !== "." && search !== ".." && !/^__.*__$/.test(search) && !search.includes("/");
    const direct = validUid ? await tx.get(users.doc(search)) : null;
    const matches = direct?.exists ? [direct] : (await tx.get(users.where("email", "==", search.toLowerCase()).limit(10))).docs;
    const roles = await Promise.all(matches.map((user) => tx.get(db.collection("roles").doc(user.id))));
    return matches.map((user, index) => ({ uid: user.id, email: user.data()!.email, displayName: user.data()!.displayName,
      provider: user.data()!.provider, admin: roles[index].data()?.admin === true, roleVersion: roles[index].data()?.version ?? 0 }));
  }, { readOnly: true });
}

export async function setAdminRole(db: Firestore, actorId: string, uid: string, enabled: boolean, expectedVersion: number) {
  targetUid(uid);
  const audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    await assertStatsAdmin(tx, db, actorId);
    const userRef = db.collection("users").doc(uid), roleRef = db.collection("roles").doc(uid), stateRef = db.doc("roles/_state");
    const [user, role, state] = await Promise.all([tx.get(userRef), tx.get(roleRef), tx.get(stateRef)]);
    if (!user.exists || user.data()?.provider !== "google.com" || user.data()?.emailVerified !== true) {
      throw new StatsError("invalid-user", "The target must first sign in with a verified Google account.", 422);
    }
    const previous = role.data()?.admin === true, version = role.data()?.version ?? 0;
    if (previous === enabled) return { admin: previous, version };
    if (version !== expectedVersion) throw new StatsError("stale-version", "This role changed. Look up the account again.", 409);
    const count = state.data()?.adminCount;
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(state.data()?.version) || state.data()!.version < 1) throw new StatsError("role-integrity", "Administrator role state is inconsistent.", 409);
    if (!enabled && count === 1) throw new StatsError("last-admin", "The last administrator cannot be revoked.", 422);
    const at = new Date().toISOString();
    tx.set(roleRef, { admin: enabled, version: version + 1, updatedAt: at, updatedBy: actorId });
    tx.update(stateRef, { adminCount: count + (enabled ? 1 : -1), version: state.data()!.version + 1 });
    tx.create(audit, { actorId, action: enabled ? "grant-admin" : "revoke-admin", targetUid: uid, at, version: version + 1 });
    return { admin: enabled, version: version + 1 };
  });
}

/** Operator-only, one-time bootstrap. Normal grants always go through setAdminRole. */
export async function bootstrapStatsAdmin(db: Firestore, auth: Auth, uid: string) {
  targetUid(uid);
  const account = await auth.getUser(uid);
  if (account.disabled || !account.emailVerified || !account.providerData.some((provider) => provider.providerId === "google.com")) {
    throw new StatsError("invalid-user", "Bootstrap requires an existing verified Google-authenticated account.", 422);
  }
  const audit = db.doc(statsPaths.audit(randomUUID()));
  return db.runTransaction(async (tx) => {
    const state = await tx.get(db.doc("roles/_state"));
    const existing = await tx.get(db.collection("roles").where("admin", "==", true).limit(1));
    const user = await tx.get(db.collection("users").doc(uid));
    if (state.exists || !existing.empty) throw new StatsError("already-bootstrapped", "Bootstrap has already run. Use administrator role management.", 409);
    if (!user.exists || user.data()?.provider !== "google.com") throw new StatsError("login-required", "Sign in at /login before bootstrapping this UID.", 422);
    const at = new Date().toISOString();
    tx.create(db.doc(`roles/${uid}`), { admin: true, version: 1, updatedAt: at, updatedBy: uid });
    tx.create(db.doc("roles/_state"), { adminCount: 1, version: 1 });
    tx.create(audit, { actorId: uid, action: "bootstrap-admin", targetUid: uid, at, version: 1 });
    return { uid, version: 1 };
  });
}
