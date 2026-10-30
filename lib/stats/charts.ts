import type { listPublicHistory, listPublicPlayers } from "@/server/stats/public-queries";

export type ChartBar = { id: string; label: string; value: number | null; href?: string; detail?: string };

export function scoreRange(values: Array<number | null>, percentage = false) {
  const known = values.filter((value): value is number => value !== null);
  const minimum = Math.min(0, ...known), maximum = Math.max(percentage ? 1 : 0, ...known);
  return { minimum, maximum, span: maximum - minimum || 1 };
}

export function playerWinRateBars(players: Awaited<ReturnType<typeof listPublicPlayers>>["items"]): ChartBar[] {
  return players.map((person) => ({ id: person.id, label: person.displayName, href: `/stats/players/${person.id}`,
    value: person.summary.winRate, detail: `${person.summary.wins} win${person.summary.wins === 1 ? "" : "s"} · ${person.summary.gamesPlayed} game${person.summary.gamesPlayed === 1 ? "" : "s"} played${person.summary.provisionalGames > 0 ? ` · ${person.summary.provisionalGames} provisional game${person.summary.provisionalGames === 1 ? "" : "s"}` : ""}` }));
}

export function historyScoreBars(history: Awaited<ReturnType<typeof listPublicHistory>>, role: "player" | "host"): ChartBar[] {
  return history.items.map(({ game, teamPoints, percentage }) => ({ id: game.id, label: game.title || game.id,
    href: `/stats/games/${game.id}`, value: role === "host" ? percentage.value : teamPoints }));
}
