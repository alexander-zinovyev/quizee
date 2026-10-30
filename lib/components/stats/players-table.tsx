"use client";
import Link from "next/link";
import type { listPublicPlayers } from "@/server/stats/public-queries";
import { statsNumber, statsPercent } from "@/lib/stats/value";
import { SortHeading, PageLinks } from "./table-navigation";

export default function PlayersTable({ data }: { data: Awaited<ReturnType<typeof listPublicPlayers>> }) {
  if (!data.items.length) return <><p className="rounded-xl border border-dashed p-6 text-zinc-500">No mapped player histories on this page.</p><PageLinks prefix="players" nextCursor={data.nextCursor} /></>;
  const headings = [["Games", "gamesPlayed"], ["Wins", "wins"], ["Win rate", "winRate"], ["Ties", "ties"], ["Losses", "losses"], ["Team points in games played", "teamPoints"], ["Point percentage", "pointPercentage"]];
  return <><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><caption className="sr-only">Mapped player statistics</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr><th className="px-3 py-3 text-left" scope="col">Player</th>{headings.map(([label, field]) => <SortHeading {...data} key={field} label={label} field={field} prefix="players" />)}</tr></thead><tbody>{data.items.map((person) => <tr key={person.id} className="border-t align-top">
    <td className="px-3 py-4"><Link className="font-semibold text-emerald-700 underline dark:text-emerald-400" href={`/stats/players/${person.id}`}>{person.displayName}</Link>{person.summary.provisionalGames > 0 && <small className="block text-amber-700 dark:text-amber-300">{person.summary.provisionalGames} provisional game(s)</small>}</td>
    {[person.summary.gamesPlayed, person.summary.wins].map((value, index) => <td className="px-3 py-4 tabular-nums" key={index}>{value}</td>)}<td className="px-3 py-4 tabular-nums">{statsPercent(person.summary.winRate)}{person.summary.resultsUnavailable > 0 && <small className="block">{person.summary.resultsUnavailable} result(s) unavailable</small>}</td>
    <td className="px-3 py-4">{person.summary.ties}</td><td className="px-3 py-4">{person.summary.losses}</td><td className="px-3 py-4 tabular-nums">{statsNumber(person.summary.teamPoints)}<small className="block text-zinc-500">{person.summary.gamesWithKnownPoints} game(s) with known totals</small></td><td className="px-3 py-4">{statsPercent(person.summary.pointPercentage)}<small className="block text-zinc-500">{person.percentage.coverage.eligibleGames}/{person.percentage.coverage.totalGames} eligible game(s)</small></td>
  </tr>)}</tbody></table></div><PageLinks prefix="players" nextCursor={data.nextCursor} /></>;
}
