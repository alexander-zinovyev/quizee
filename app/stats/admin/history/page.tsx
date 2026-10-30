import Link from "next/link";
import { getServerFirestore } from "@/server/database";
import { listStatsAudit } from "@/server/stats/admin-queries";
import { pageStatsAdmin } from "@/server/stats/http";
import type { StatsPageSearch } from "@/server/stats/page-options";

export default async function ChangeHistory({ searchParams }: { searchParams: Promise<StatsPageSearch> }) {
  const params = await searchParams;
  const data = await listStatsAudit(getServerFirestore(), await pageStatsAdmin(), typeof params.cursor === "string" ? params.cursor : null);
  return <section className="space-y-5"><h1 className="text-3xl font-semibold">Administrator change history</h1><p>Publication, identity, review, role, and maintenance changes, newest first. References identify the saved records; debug logs are kept separately.</p>
    <ol className="space-y-4">{data.items.map((event) => <li className="space-y-2 break-words rounded-xl border p-4" key={event.id}><p className="font-semibold">{event.action.replaceAll("-", " ")}</p><p className="text-sm"><time dateTime={event.at}>{event.at}</time> · Administrator: {event.actorId}</p>{event.gameId && <p><Link className="text-emerald-700 underline" href={`/stats/admin/games/${event.gameId}`}>Game {event.gameId}</Link>{event.version !== null && `, version ${event.version}`}</p>}{event.personId && <p className="text-sm">Person: {event.personId}</p>}{event.snapshotId && <p className="text-xs text-zinc-500">Snapshot: {event.snapshotId}</p>}{event.changedFields.length > 0 && <p className="text-sm">Changed: {event.changedFields.join(", ")}</p>}</li>)}</ol>
    {!data.items.length && <p>No administrator changes recorded.</p>}<nav aria-label="Change history pages" className="flex gap-5"><Link className="underline" href="/stats/admin/history">Newest</Link>{data.nextCursor && <Link className="underline" href={`/stats/admin/history?cursor=${encodeURIComponent(data.nextCursor)}`}>Older changes</Link>}</nav>
  </section>;
}
