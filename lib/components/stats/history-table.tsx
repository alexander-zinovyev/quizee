"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import type { listPublicHistory } from "@/server/stats/public-queries";
import { gameSortValues } from "@/server/stats/model";
import { statsDate, statsNumber, statsPercent } from "@/lib/stats/value";
import { ExpandedRoster } from "./games-table";
import { SortHeading, PageLinks } from "./table-navigation";

export default function HistoryTable({ data, role }: { data: Awaited<ReturnType<typeof listPublicHistory>>; role: "player" | "host" }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const headings = role === "host" ? [["Date (UTC)", "date"], ["Comparable team percentage", "pointPercentage"], ["Top score", "topScore"], ["Total score", "totalScore"]]
    : [["Date (UTC)", "date"], ["Team points", "teamPoints"], ["Result", "result"], ["Point percentage", "pointPercentage"]];
  return <><div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><caption className="sr-only">Published {role} game history</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr><th className="px-3 py-3 text-left" scope="col">Game</th>{role === "player" && <th className="px-3 py-3 text-left" scope="col">Team</th>}{headings.map(([label, field]) => <SortHeading {...data} prefix="history" key={field} label={label} field={field} />)}<th scope="col" className="px-3">Roster</th></tr></thead><tbody>{data.items.map(({ game, teamId, teamPoints, outcome, percentage }) => {
    const values = gameSortValues(game);
    return <Fragment key={game.id}><tr className="border-t align-top"><td className="px-3 py-4"><Link className="font-semibold text-emerald-700 underline dark:text-emerald-400" href={`/stats/games/${game.id}`}>{game.title || game.id}</Link><small className="block text-zinc-500">{game.packLabel ?? "Pack unavailable"}</small>{game.provisional && <small className="block text-amber-700 dark:text-amber-300">Grading incomplete at publication</small>}</td>
      {role === "player" && <td className="px-3 py-4">{game.teams.find((team) => team.id === teamId)?.name ?? "Team name unavailable"}</td>}<td className="whitespace-nowrap px-3 py-4">{statsDate(game.completedAt)}</td>
      {role === "player" ? <><td className="px-3 py-4 tabular-nums">{statsNumber(teamPoints)}</td><td className="px-3 py-4">{outcome === "unavailable" ? "Outcome unavailable" : outcome}</td><td className="px-3 py-4">{statsPercent(percentage.value)}<small className="block text-zinc-500">{percentage.coverage.eligibleQuestionTeams}/{percentage.coverage.totalQuestionTeams} paired scores</small></td></>
        : <><td className="px-3 py-4">{statsPercent(percentage.value)}<small className="block text-zinc-500">{percentage.coverage.eligibleTeams}/{percentage.coverage.totalTeams} eligible team results</small></td>{["topScore", "totalScore"].map((key) => <td className="px-3 py-4" key={key}>{values[key].availability ? "Unavailable" : statsNumber(values[key].value as number)}</td>)}</>}
      <td className="px-3 py-4"><button className="text-emerald-700 underline dark:text-emerald-400" aria-expanded={expanded === game.id} aria-controls={`history-roster-${game.id}`} onClick={() => setExpanded(expanded === game.id ? null : game.id)}>{expanded === game.id ? "Hide" : "View roster"}</button></td>
    </tr>{expanded === game.id && <tr><td colSpan={role === "host" ? 6 : 7} id={`history-roster-${game.id}`} className="border-t p-5"><ExpandedRoster key={`${game.id}:${game.version}`} id={game.id} version={game.version} /></td></tr>}</Fragment>;
  })}</tbody></table>{!data.items.length && <p className="p-6 text-zinc-500">No games on this page.</p>}</div><PageLinks prefix="history" nextCursor={data.nextCursor} /></>;
}
