import Link from "next/link";
export default function StatsNotFound() { return <main className="mx-auto max-w-2xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Statistics unavailable</h1><p>This game or profile is not available in published statistics.</p><Link className="text-emerald-700 underline" href="/stats">Browse statistics</Link></main>; }
