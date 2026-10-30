"use client";
import Link from "next/link";

export default function StatsErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="mx-auto max-w-2xl space-y-5 p-8"><h1 className="text-2xl font-semibold">Unable to load statistics</h1><p role="alert">Statistics could not be loaded. Reload this view or return to the first page.</p><button className="rounded-lg bg-emerald-600 px-5 py-2 text-white" onClick={reset}>Reload</button><Link className="ml-4 underline" href="/stats">First page</Link></main>;
}
