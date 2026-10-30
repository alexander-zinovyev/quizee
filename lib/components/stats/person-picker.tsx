"use client";
import { useEffect, useRef, useState } from "react";
import { readJsonResponse } from "@/lib/api-response";
import { normalizeStatsName, type StatsPersonRecord } from "@/server/stats/model";
import { replaceHostAggregate, replacePlayerAggregate } from "@/server/stats/aggregates";
import type { CreateStatsPerson } from "@/server/stats/people";
import PersonFields, { personFieldsInput, type PersonFieldsValue } from "./person-fields";

export type PersonChoice = Pick<StatsPersonRecord, "displayName" | "helperAliases" | "notes" | "player" | "host" | "version" | "mappingCount" | "archived"> & { id: string };

export default function PersonPicker({ alias, localChoices, onChoose, onUnresolved, onClose }: { alias: string | null; localChoices: PersonChoice[];
  onChoose: (person: PersonChoice, creation?: CreateStatsPerson) => void; onUnresolved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [search, setSearch] = useState(alias ?? ""), [items, setItems] = useState<PersonChoice[]>([]);
  const [creationId] = useState(() => crypto.randomUUID()), [fields, setFields] = useState<PersonFieldsValue>({ displayName: alias ?? "", aliases: "", notes: "" });
  const [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { const element = dialog.current!; if (!element.open) element.showModal(); return () => element.close(); }, []);
  async function find() {
    setBusy(true); setError(null);
    try {
      const result = await readJsonResponse<{ items: PersonChoice[] }>(await fetch(`/api/stats/admin/people?search=${encodeURIComponent(search.trim())}`, { cache: "no-store" }), "Search people");
      const found = new Map(result.items.map((person) => [person.id, person])), query = normalizeStatsName(search);
      localChoices.filter((person) => normalizeStatsName(person.displayName).startsWith(query) || person.helperAliases.some((alias) => normalizeStatsName(alias) === query)).forEach((person) => { if (!found.has(person.id)) found.set(person.id, person); });
      setItems([...found.values()]); setSearched(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to search people."); }
    finally { setBusy(false); }
  }
  function create() {
    const data = { id: creationId, ...personFieldsInput(fields) };
    onChoose({ ...data, version: 1, mappingCount: 0, archived: false, player: replacePlayerAggregate(null, null, null), host: replaceHostAggregate(null, null, null) }, data);
  }
  return <dialog ref={dialog} onCancel={onClose} aria-label="Link a person" className="m-auto max-h-[90vh] w-[min(95vw,42rem)] space-y-5 overflow-y-auto rounded-2xl border bg-white p-6 text-zinc-900 shadow-xl backdrop:bg-black/50 dark:bg-zinc-900 dark:text-zinc-100">
    <header className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Link a person</h2><p className="mt-1 text-sm">Recorded alias: {alias || "Unavailable"}</p></div><button type="button" className="underline" onClick={onClose}>Close</button></header>
    <form className="flex gap-3" onSubmit={(event) => { event.preventDefault(); void find(); }}><label className="flex flex-1 flex-col gap-1">Name, exact alias, or person ID<input className="rounded-lg border bg-transparent p-2" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} required /></label><button className="self-end rounded-lg border px-4 py-2" disabled={busy}>Search people</button></form>
    {error && <p role="alert" className="text-red-600">{error}</p>}{searched && !items.length && <p>No matches. You can create a person or leave this identity unresolved.</p>}
    <ul className="space-y-3">{items.map((person) => <li className="rounded-xl border p-4" key={person.id}><p className="font-semibold">{person.displayName}</p><p className="text-xs text-zinc-500">Person reference: {person.id}</p>{person.helperAliases.length > 0 && <p className="mt-1 text-sm">Helper aliases: {person.helperAliases.join(", ")}</p>}{person.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{person.notes}</p>}<button type="button" className="mt-2 text-emerald-700 underline" onClick={() => onChoose(person)}>Choose {person.displayName}</button></li>)}</ul>
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Create a new person and link</summary><form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); create(); }}><PersonFields value={fields} onChange={setFields} /><p className="text-xs text-zinc-500">Names are not unique. Use context to distinguish people; this creates a separate identity record.</p><button className="rounded-lg bg-emerald-600 px-4 py-2 text-white">Create and link</button></form></details>
    <button type="button" className="text-sm underline" onClick={onUnresolved}>Leave unresolved</button>
  </dialog>;
}
