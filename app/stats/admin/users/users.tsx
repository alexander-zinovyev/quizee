"use client";

import { useState } from "react";
import { readJsonResponse } from "@/lib/api-response";

type DirectoryUser = { uid: string; email: string; displayName: string | null; provider: string; admin: boolean; roleVersion: number };
export default function Users() {
  const [search, setSearch] = useState(""), [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [selected, setSelected] = useState<DirectoryUser | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  async function lookup() {
    setBusy(true); setMessage(null); setSelected(null);
    try { const result = await readJsonResponse<{ items: DirectoryUser[] }>(await fetch(`/api/stats/admin/users?search=${encodeURIComponent(search.trim())}`, { cache: "no-store" }), "Find account"); setUsers(result.items); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to find account."); }
    finally { setBusy(false); }
  }
  async function change(user: DirectoryUser) {
    setBusy(true); setMessage(null);
    try {
      await readJsonResponse(await fetch(`/api/stats/admin/users/${encodeURIComponent(user.uid)}/role`, { method: user.admin ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: user.roleVersion }) }), "Change administrator access");
      setSelected(null); setUsers(null); setMessage(`Administrator access ${user.admin ? "revoked" : "granted"} for ${user.email}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to change access."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5"><h1 className="text-3xl font-semibold">Administrators</h1><p>Find an account that has already signed in with Google, then review its identity before changing access.</p>
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void lookup(); }}><label className="flex flex-1 flex-col gap-1">Exact email or account UID<input className="rounded-lg border bg-transparent p-2" value={search} onChange={(event) => setSearch(event.target.value)} required maxLength={320} /></label><button className="self-end rounded-lg bg-emerald-600 px-5 py-2 text-white" disabled={busy}>Find account</button></form>
    {users?.length === 0 && <p>No signed-in account matches. Ask the person to sign in at /login first.</p>}
    {users?.map((user) => <article className="space-y-2 rounded-xl border p-4" key={user.uid}><p className="font-semibold">{user.displayName ?? user.email}</p><p>{user.email}</p><p className="break-all text-sm">UID: {user.uid}</p><p>{user.admin ? "Administrator" : "No administrator access"}</p>
      <button className="text-emerald-600 underline" disabled={busy} onClick={() => setSelected(user)}>{user.admin ? "Review revocation" : "Review grant"}</button></article>)}
    {selected && <div className="space-y-3 rounded-xl border border-amber-500 p-5" role="region" aria-label="Confirm access change"><h2 className="font-semibold">{selected.admin ? "Revoke" : "Grant"} administrator access</h2><p>{selected.email}</p><p className="break-all text-sm">UID: {selected.uid}</p><p>{selected.admin ? "Their next administrator request will be refused. The last administrator cannot be removed." : "This account will be able to publish games, correct statistics, and manage administrator access."}</p><div className="flex gap-4"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-white" disabled={busy} onClick={() => void change(selected)}>Confirm {selected.admin ? "revocation" : "grant"}</button><button disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
