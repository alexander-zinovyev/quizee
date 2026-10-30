"use client";
import Link from "next/link";
import { useState } from "react";

export default function FrequencyList({ items }: { items: Array<{ personId: string; displayName: string; games: number }> }) {
  const [limit, setLimit] = useState(10);
  return <div className="space-y-3">{items.length ? <ol className="space-y-1">{items.slice(0, limit).map((person) => <li className="flex justify-between gap-4" key={person.personId}><Link className="text-emerald-700 underline dark:text-emerald-400" href={`/stats/players/${person.personId}`}>{person.displayName}</Link><span>{person.games} game(s)</span></li>)}</ol> : <p className="text-zinc-500">No mapped appearances available.</p>}{items.length > limit && <button className="text-sm underline" onClick={() => setLimit(limit + 10)}>Show more</button>}</div>;
}
