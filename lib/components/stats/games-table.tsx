"use client";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicStatsGame, StatsList } from "@/types/stats";
import type { PublicStatsGameDetail } from "@/types/stats-public";
import { readJsonResponse } from "@/lib/api-response";
import { statsDate, statsNumber } from "@/lib/stats/value";
import { gameSortValues } from "@/server/stats/model";
import { PageLinks, SortHeading } from "./table-navigation";

export function Roster({ game }: { game: PublicStatsGameDetail }) {
  const groups = [...game.teams.map((team) => ({ id: team.id, name: team.name ?? "Team name unavailable" })), { id: null, name: "Unassigned" }];
  return <div className="grid gap-4 sm:grid-cols-2">{groups.map((team) => {
    const members = game.roster.filter((member) => member.teamId === team.id);
    if (!members.length) return null;
    return <section key={team.id ?? "unassigned"}><h3 className="font-semibold">{team.name}</h3><ul className="mt-2 space-y-1 text-sm">{members.map((member) => <li key={member.appearanceId}>
      {member.personId ? member.profile ? <Link className="text-emerald-700 underline dark:text-emerald-400" href={`/stats/${member.profile === "player" ? "players" : "hosts"}/${member.personId}`}>{member.displayName ?? member.alias ?? "Name unavailable"}</Link> : <span>{member.displayName ?? member.alias ?? "Name unavailable"}</span> : <span>{member.alias || "Name unavailable"} <span className="text-amber-700 dark:text-amber-300">(unresolved)</span></span>}
      {member.displayName && member.alias && member.displayName !== member.alias && <span className="text-zinc-500"> as {member.alias}</span>}{member.duplicateOf && <span className="text-zinc-500"> (duplicate entry, counted once)</span>}
    </li>)}</ul>{team.id === null && <p className="mt-2 text-xs text-zinc-500">Unassigned members receive no team result or player aggregate credit.</p>}</section>;
  })}<p className="text-xs text-zinc-500 sm:col-span-2">Roster recorded at the snapshot. Earlier participation is unavailable.</p></div>;
}

export function ExpandedRoster({ id, version }: { id: string; version: number }) {
  const router = useRouter(), [game, setGame] = useState<PublicStatsGameDetail | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/stats/games/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then((response) => readJsonResponse<PublicStatsGameDetail>(response, "Load roster")).then((result) => {
      if (result.version !== version) { router.refresh(); return; } setGame(result);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load roster."); });
    return () => controller.abort();
  }, [id, version, router]);
  if (error) return <p role="alert">{error}</p>;
  return game ? <Roster game={game} /> : <p role="status">Loading roster…</p>;
}

export default function GamesTable({ data, prefix = "games" }: { data: StatsList<PublicStatsGame>; prefix?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data.items.length) return <><p className="rounded-xl border border-dashed p-6 text-zinc-500">No games have been published on this page.</p><PageLinks prefix={prefix} nextCursor={data.nextCursor} /></>;
  const headings = [["Date (UTC)", "date"], ["Host", "host"], ["Top score", "topScore"], ["Total score", "totalScore"], ["Margin", "margin"], ["Pack", "pack"]];
  return <><div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700"><table className="w-full text-sm"><caption className="sr-only">Published games</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr><th className="px-3 py-3 text-left" scope="col">Game</th>{headings.map(([label, field]) => <SortHeading key={field} {...data} prefix={prefix} label={label} field={field} firstDirection={field === "host" || field === "pack" ? "asc" : "desc"} />)}<th scope="col" className="px-3">Result / roster</th></tr></thead>
    <tbody>{data.items.map((game) => { const values = gameSortValues(game); return <Fragment key={game.id}><tr className="border-t border-zinc-200 align-top dark:border-zinc-700">
      <td className="px-3 py-4"><Link className="font-semibold text-emerald-700 underline dark:text-emerald-400" href={`/stats/games/${game.id}`}>{game.title || game.id}</Link>{game.provisional && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Grading incomplete at publication</p>}{game.unresolvedAppearances > 0 && <p className="mt-1 text-xs text-zinc-500">{game.unresolvedAppearances} unresolved roster entries</p>}</td>
      <td className="whitespace-nowrap px-3 py-4">{statsDate(game.completedAt)}</td><td className="px-3 py-4">{game.host?.personId ? <Link href={`/stats/hosts/${game.host.personId}`} className="underline">{game.host.displayName || game.host.alias || "Host"}</Link> : <span>{game.host?.alias || "Host unavailable"}<small className="block text-zinc-500">Host not linked</small></span>}</td>
      {["topScore", "totalScore", "margin"].map((key) => <td className="px-3 py-4 tabular-nums" key={key}>{values[key].availability ? "Unavailable" : statsNumber(values[key].value as number)}</td>)}<td className="px-3 py-4">{game.packLabel ?? "Pack unavailable"}</td>
      <td className="min-w-44 px-3 py-4"><p>{game.teams.filter((team) => team.outcome === "win" || team.outcome === "tie").map((team) => `${team.name ?? "Unnamed team"} ${team.outcome === "tie" ? "(shared first)" : "wins"}`).join(", ") || "Outcome unavailable"}</p><button className="mt-2 text-emerald-700 underline dark:text-emerald-400" aria-expanded={expanded === game.id} aria-controls={`roster-${game.id}`} onClick={() => setExpanded(expanded === game.id ? null : game.id)}>{expanded === game.id ? "Hide roster" : "View roster"}</button></td>
    </tr>{expanded === game.id && <tr><td id={`roster-${game.id}`} colSpan={8} className="border-t bg-zinc-50 p-5 dark:bg-zinc-900"><ExpandedRoster key={`${game.id}:${game.version}`} id={game.id} version={game.version} /></td></tr>}</Fragment>; })}</tbody></table></div><PageLinks prefix={prefix} nextCursor={data.nextCursor} /></>;
}
