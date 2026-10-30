"use client";
import { useId } from "react";

export type PersonFieldsValue = { displayName: string; aliases: string; notes: string };
export const personFieldsInput = (value: PersonFieldsValue) => ({ displayName: value.displayName, helperAliases: value.aliases.split("\n").map((alias) => alias.trim()).filter(Boolean), notes: value.notes });

export default function PersonFields({ value, onChange }: { value: PersonFieldsValue; onChange: (value: PersonFieldsValue) => void }) {
  const id = useId();
  return <div className="space-y-3"><label className="flex flex-col gap-1" htmlFor={`${id}-name`}>Display name<input id={`${id}-name`} className="rounded-lg border bg-transparent p-2" value={value.displayName} onChange={(event) => onChange({ ...value, displayName: event.target.value })} maxLength={200} required /></label>
    <label className="flex flex-col gap-1" htmlFor={`${id}-aliases`}>Private helper aliases, one per line<textarea id={`${id}-aliases`} className="rounded-lg border bg-transparent p-2" value={value.aliases} onChange={(event) => onChange({ ...value, aliases: event.target.value })} maxLength={10000} rows={2} /></label>
    <label className="flex flex-col gap-1" htmlFor={`${id}-notes`}>Private notes<textarea id={`${id}-notes`} className="rounded-lg border bg-transparent p-2" value={value.notes} onChange={(event) => onChange({ ...value, notes: event.target.value })} maxLength={5000} rows={2} /></label><p className="text-xs text-zinc-500">Helper aliases and notes stay private. Public aliases come from corrected, published game history.</p>
  </div>;
}
