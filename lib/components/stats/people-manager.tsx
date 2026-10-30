"use client";
import { useState } from "react";
import { readJsonResponse } from "@/lib/api-response";
import type { StatsPersonRecord } from "@/server/stats/model";
import PersonFields, { personFieldsInput, type PersonFieldsValue } from "./person-fields";

type Person = StatsPersonRecord & { id: string };
const blank = (): PersonFieldsValue => ({ displayName: "", aliases: "", notes: "" });
const fieldsFor = (person: Person): PersonFieldsValue => ({ displayName: person.displayName, aliases: person.helperAliases.join("\n"), notes: person.notes });

export default function PeopleManager() {
  const [search, setSearch] = useState(""), [items, setItems] = useState<Person[] | null>(null), [selected, setSelected] = useState<Person | null>(null);
  const [editing, setEditing] = useState<PersonFieldsValue>(blank), [creating, setCreating] = useState<PersonFieldsValue>(blank), [creationId, setCreationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [archive, setArchive] = useState(false), [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  async function lookup(query: string) {
    return readJsonResponse<{ items: Person[] }>(await fetch(`/api/stats/admin/people?search=${encodeURIComponent(query.trim())}`, { cache: "no-store" }), "Find people");
  }
  async function find() {
    setBusy(true); setError(null); setMessage(null);
    try { setItems((await lookup(search)).items); setSelected(null); setArchive(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to search people."); }
    finally { setBusy(false); }
  }
  function select(person: Person) { setSelected(person); setEditing(fieldsFor(person)); setArchive(false); setError(null); setMessage(null); }
  async function create() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await readJsonResponse<{ id: string }>(await fetch("/api/stats/admin/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: creationId, ...personFieldsInput(creating) }) }), "Create person");
      const person = (await lookup(result.id)).items.find((person) => person.id === result.id);
      if (!person) throw new Error("Created person could not be loaded.");
      select(person); setItems([person]); setCreating(blank()); setCreationId(crypto.randomUUID()); setMessage("Person created. Link recorded game appearances in game review.");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to create person."); }
    finally { setBusy(false); }
  }
  async function save(archived = false) {
    if (!selected) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await readJsonResponse(await fetch(`/api/stats/admin/people/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: selected.version, ...personFieldsInput(editing), ...(archived ? { archived: true } : {}) }) }), archived ? "Archive person" : "Save person");
      if (archived) { setItems((previous) => previous?.filter((person) => person.id !== selected.id) ?? null); setSelected(null); setArchive(false); setMessage("Person archived. The identity reference remains a tombstone."); }
      else { const person = (await lookup(selected.id)).items.find((person) => person.id === selected.id); if (!person) throw new Error("Updated person could not be loaded."); select(person); setItems((previous) => previous?.map((item) => item.id === person.id ? person : item) ?? [person]); setMessage("Person updated."); }
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save person."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-6"><header className="space-y-3"><h1 className="text-3xl font-semibold">People</h1><p>Maintain stable identities across recorded aliases. Similar names are suggestions; they do not establish that two appearances belong to one person.</p></header>
    {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status" className="text-emerald-700">{message}</p>}
    <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void find(); }}><label className="flex flex-1 flex-col gap-1">Name, exact helper/recorded alias, or person ID<input className="rounded-lg border bg-transparent p-2" value={search} onChange={(event) => setSearch(event.target.value)} required maxLength={200} /></label><button className="self-end rounded-lg border px-4 py-2" disabled={busy}>Find people</button></form>
    {items?.length === 0 && <p>No matching active identities.</p>}<div className="grid gap-3 sm:grid-cols-2">{items?.map((person) => <article className="space-y-2 rounded-xl border p-4" key={person.id}><p className="font-semibold">{person.displayName}</p><p className="break-all text-xs text-zinc-500">{person.id}</p>{person.helperAliases.length > 0 && <p className="text-sm">Helper aliases: {person.helperAliases.join(", ")}</p>}{person.notes && <p className="whitespace-pre-wrap text-sm">{person.notes}</p>}<p className="text-xs text-zinc-500">{person.mappingCount} player/host mapping(s), including unpublished reviews.</p><button className="text-emerald-700 underline" disabled={busy} onClick={() => select(person)}>Edit {person.displayName}</button></article>)}</div>
    {selected && <section className="space-y-4 rounded-xl border p-5"><h2 className="text-xl font-semibold">Edit identity</h2><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}><PersonFields value={editing} onChange={setEditing} /><div className="flex gap-4"><button className="rounded-lg bg-emerald-600 px-4 py-2 text-white" disabled={busy}>Save identity</button><button type="button" className="underline" disabled={busy} onClick={() => { setSelected(null); setArchive(false); }}>Close editor</button></div></form>
      {selected.mappingCount > 0 ? <p className="text-sm text-zinc-500">This person is still mapped. Correct individual game mappings before archiving a duplicate identity.</p> : <button className="text-sm text-rose-700 underline" disabled={busy} onClick={() => setArchive(true)}>Archive unused identity</button>}
      {archive && <section className="space-y-3 rounded-lg border border-amber-500 p-4" aria-label="Confirm archive"><p>Archive {selected.displayName}? Its identity reference will remain, and it cannot receive new mappings.</p><button className="rounded-lg border px-4 py-2" disabled={busy} onClick={() => void save(true)}>Confirm archive</button><button className="ml-4 underline" disabled={busy} onClick={() => setArchive(false)}>Cancel</button></section>}
    </section>}
    <details className="rounded-xl border p-5"><summary className="cursor-pointer text-xl font-semibold">Create a separate person</summary><form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void create(); }}><p className="text-sm text-zinc-500">Search for an existing identity first. Identical display names are allowed when they represent different people.</p><PersonFields value={creating} onChange={setCreating} /><button className="rounded-lg bg-emerald-600 px-4 py-2 text-white" disabled={busy}>Create person</button></form></details>
  </section>;
}
