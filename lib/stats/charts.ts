import type { PublicStatsGame } from "@/types/stats";
import type { listPublicHistory } from "@/server/stats/public-queries";

export type ChartBar = { id: string; label: string; value: number | null; href?: string };

export function scoreRange(values: Array<number | null>, percentage = false) {
  const known = values.filter((value): value is number => value !== null);
  const minimum = Math.min(0, ...known), maximum = Math.max(percentage ? 1 : 0, ...known);
  return { minimum, maximum, span: maximum - minimum || 1 };
}

export function gameScoreBars(games: PublicStatsGame[]): ChartBar[] {
  return games.map((game) => ({ id: game.id, label: game.title || game.id, href: `/stats/games/${game.id}`,
    value: game.teams.length && game.teams.every((team) => team.score !== null) ? Math.max(...game.teams.map((team) => team.score!)) : null }));
}

export function historyScoreBars(history: Awaited<ReturnType<typeof listPublicHistory>>, role: "player" | "host"): ChartBar[] {
  return history.items.map(({ game, teamPoints, percentage }) => ({ id: game.id, label: game.title || game.id,
    href: `/stats/games/${game.id}`, value: role === "host" ? percentage.value : teamPoints }));
}
