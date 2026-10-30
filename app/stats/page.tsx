import { getServerFirestore } from "@/server/database";
import { listPublicGames, listPublicPlayers } from "@/server/stats/public-queries";
import { statsPageOptions, type StatsPageSearch } from "@/server/stats/page-options";
import GamesTable from "@/lib/components/stats/games-table";
import PlayersTable from "@/lib/components/stats/players-table";
import { PercentageHelp } from "@/lib/components/stats/percentage";

export const dynamic = "force-dynamic";
export default async function StatsPage({ searchParams }: { searchParams: Promise<StatsPageSearch> }) {
  const params = await searchParams, db = getServerFirestore();
  const [games, players] = await Promise.all([listPublicGames(db, statsPageOptions(params, "games")), listPublicPlayers(db, statsPageOptions(params, "players"))]);
  return <main className="mx-auto max-w-6xl space-y-10 px-6 py-10"><header><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Past games, linked histories</p><h1 className="mt-2 text-4xl font-semibold">Game statistics</h1><p className="mt-3 max-w-3xl text-zinc-600 dark:text-zinc-400">Explore published results and the people behind each team. Player and host histories include appearances linked by an administrator; unresolved identities stay visible in game rosters.</p></header>
    <section className="space-y-4"><h2 className="text-2xl font-semibold">Games</h2><GamesTable data={games} /></section><section className="space-y-4"><h2 className="text-2xl font-semibold">Players</h2><PlayersTable data={players} /></section><PercentageHelp />
  </main>;
}
