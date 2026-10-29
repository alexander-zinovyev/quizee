"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from "firebase/auth";
import { getStatsAdminAuth } from "@/lib/firebase/admin-client";
import { readJsonResponse } from "@/lib/api-response";

type Session = { uid: string; displayName: string | null; email: string; admin: boolean };

export default function Login() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(true), [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/admin/session", { cache: "no-store" });
      if (response.status === 401) setSession(null);
      else setSession(await readJsonResponse<Session>(response, "Check session"));
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to check your session."); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);

  async function login() {
    setBusy(true); setError(null);
    try {
      const auth = getStatsAdminAuth();
      await setPersistence(auth, inMemoryPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      const response = await fetch("/api/auth/admin/session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await credential.user.getIdToken() }) });
      await readJsonResponse(response, "Sign in");
      await signOut(auth);
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(null);
    try {
      await readJsonResponse(await fetch("/api/auth/admin/session", { method: "DELETE" }), "Sign out");
      await signOut(getStatsAdminAuth());
      setSession(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to sign out."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8 text-zinc-900 dark:text-zinc-100">
    <Link href="/" className="text-sm text-emerald-600">Quizee</Link>
    <h1 className="text-3xl font-semibold">Statistics administration</h1>
    <p>Sign in with Google. An administrator must grant access before you can review games or manage people.</p>
    {checking ? <p role="status">Checking your session…</p> : session ? <>
      <p>Signed in as <strong>{session.email}</strong></p>
      {session.admin ? <Link className="rounded-xl bg-emerald-600 px-5 py-3 text-center font-semibold text-white" href="/stats/admin">Open administration</Link>
        : <div className="rounded-xl border border-amber-500 p-4"><p>Your account is awaiting administrator access.</p><p className="mt-2 break-all text-sm">Account UID: {session.uid}</p><p className="mt-2 text-sm">Give this UID to an existing administrator.</p></div>}
      <button className="rounded-xl border px-5 py-3" disabled={busy} onClick={() => void logout()}>Sign out</button>
    </> : <button className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void login()}>{busy ? "Signing in…" : "Continue with Google"}</button>}
    {session && !session.admin && <button className="text-emerald-600 underline" onClick={() => void refresh()}>Check access again</button>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </main>;
}
