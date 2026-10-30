"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function SortHeading({ label, field, prefix, sort, direction, firstDirection = "desc" }: { label: string; field: string; prefix: string; sort: string; direction: "asc" | "desc"; firstDirection?: "asc" | "desc" }) {
  const pathname = usePathname(), params = new URLSearchParams(useSearchParams().toString());
  params.set(`${prefix}Sort`, field); params.set(`${prefix}Direction`, sort === field ? direction === "asc" ? "desc" : "asc" : firstDirection); params.delete(`${prefix}Cursor`);
  return <th scope="col" aria-sort={sort === field ? direction === "asc" ? "ascending" : "descending" : "none"} className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide">
    <Link className="inline-flex gap-1 underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-emerald-500" href={`${pathname}?${params}`}>{label}<span aria-hidden="true">{sort === field ? direction === "asc" ? "↑" : "↓" : "↕"}</span></Link>
  </th>;
}

export function PageLinks({ nextCursor, prefix }: { nextCursor: string | null; prefix: string }) {
  const pathname = usePathname(), current = useSearchParams(), first = new URLSearchParams(current.toString()), next = new URLSearchParams(current.toString());
  first.delete(`${prefix}Cursor`); if (nextCursor) next.set(`${prefix}Cursor`, nextCursor);
  return <nav aria-label={`${prefix} pagination`} className="flex gap-5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
    {current.get(`${prefix}Cursor`) && <Link href={`${pathname}?${first}`}>First page</Link>}
    {nextCursor && <Link href={`${pathname}?${next}`}>Next page</Link>}
  </nav>;
}
