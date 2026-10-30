import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerFirestore } from "@/server/database";
import { StatsError } from "@/server/stats/error";
import { getPublicPlayer, getPublicHost, listPublicHistory } from "@/server/stats/public-queries";
import { statsPageOptions, type StatsPageSearch } from "@/server/stats/page-options";
import { statsNumber, statsPercent } from "@/lib/stats/value";
import Percentage, { PercentageHelp } from "./percentage";
import HistoryTable from "./history-table";
import FrequencyList from "./frequency-list";
import { ResultsChart, ScoreBars } from "./charts";
import { historyScoreBars } from "@/lib/stats/charts";

function Cards({ items }: { items: Array<[string, string | number, string?]> }) { return <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(([label, value, explanation]) => <div className="rounded-xl border bg-white p-5 dark:bg-zinc-900" key={label}><dt className="text-sm text-zinc-500">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>{explanation && <dd className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{explanation}</dd>}</div>)}</dl>; }
function Extremes({ label, items, percentage = false }: { label: string; items: Array<{ gameId: string; value: number }>; percentage?: boolean }) {
  return <details><summary className="cursor-pointer font-semibold">{label}</summary>{items.length ? <ul className="mt-2 space-y-1 text-sm">{items.map((item) => <li key={item.gameId}><Link className="text-emerald-700 underline" href={`/stats/games/${item.gameId}`}>{item.gameId}</Link>: {percentage ? statsPercent(item.value) : statsNumber(item.value)}</li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">Unavailable</p>}</details>;
}

export default async function PersonProfile({ id, role, searchParams }: { id: string; role: "player" | "host"; searchParams: StatsPageSearch }) {
  const db = getServerFirestore();
  let data;
  try { data = role === "player" ? await getPublicPlayer(db, id) : await getPublicHost(db, id); }
  catch (error) {
    if (error instanceof StatsError && error.status === 404) notFound();
    if (error instanceof StatsError && error.status === 410) return <main className="mx-auto max-w-2xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Archived profile</h1><p>This identity record has been archived after its mappings were corrected.</p><Link className="text-emerald-700 underline" href="/stats">Browse statistics</Link></main>;
    throw error;
  }
  const history = await listPublicHistory(db, id, role, statsPageOptions(searchParams, "history"));
  return <main className="mx-auto max-w-6xl space-y-8 px-6 py-10"><header className="space-y-3"><Link className="text-sm text-emerald-700 underline" href="/stats">All statistics</Link><p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">{role} history</p><h1 className="text-4xl font-semibold">{data.displayName}</h1><p>Recorded aliases: {data.aliases.join(", ") || "None recorded"}</p>{role === "player" && data.hasHostHistory && <Link className="inline-block text-emerald-700 underline" href={`/stats/hosts/${id}`}>View host history</Link>}{role === "host" && data.hasPlayerHistory && <Link className="inline-block text-emerald-700 underline" href={`/stats/players/${id}`}>View player history</Link>}</header>
    {data.summary.provisionalGames > 0 && <p className="rounded-xl border border-amber-500 p-4 text-sm">Includes {data.summary.provisionalGames} game(s) with incomplete grading at publication. Their recorded results remain provisional.</p>}
    {"streaks" in data ? <>
      <Cards items={[["Games played", data.summary.gamesPlayed], ["Wins / ties / losses", `${data.summary.wins} / ${data.summary.ties} / ${data.summary.losses}`], ["Win rate", statsPercent(data.summary.winRate)], ["Team points in games played", statsNumber(data.summary.teamPoints)]]} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Points are a team-level participation measure. Totals are known for {data.summary.gamesWithKnownPoints} of {data.summary.gamesPlayed} games; {data.summary.resultsUnavailable} result(s) are unavailable. Unresolved teammates do not suppress this player’s mapped appearance.</p>
      <ResultsChart wins={data.summary.wins} ties={data.summary.ties} losses={data.summary.losses} unavailable={data.summary.resultsUnavailable} />
      <div className="rounded-xl border p-5"><Percentage value={data.percentage} label="Points your teams earned" /></div>
      <Cards items={[["Average team points", statsNumber(data.summary.averageTeamPoints)], ["Average game percentage", statsPercent(data.summary.averageGamePercentage)], ["Current / longest win streak", `${statsNumber(data.streaks.currentWins)} / ${statsNumber(data.streaks.longestWins)}`], ["Current / longest loss streak", `${statsNumber(data.streaks.currentLosses)} / ${statsNumber(data.streaks.longestLosses)}`]]} />
      <p className="text-xs text-zinc-500">Streak coverage: {data.streaks.gamesWithDates}/{data.streaks.totalGames} games with dates, {data.streaks.gamesWithKnownOutcomes}/{data.streaks.totalGames} with known outcomes. Ties leave streaks unchanged; unknown dates or results prevent a reliable full-history claim.</p>
      <section className="space-y-4"><h2 className="text-2xl font-semibold">Performance by round type</h2><div className="grid gap-4 sm:grid-cols-2">{Object.entries(data.byRoundType).filter(([, metrics]) => metrics.percentage.coverage.eligibleQuestionTeams > 0).map(([type, metrics]) => <section className="space-y-3 rounded-xl border p-4" key={type}><h3 className="font-semibold">{type}</h3><Percentage value={metrics.percentage} label="Points earned" /></section>)}</div><p className="text-xs text-zinc-500">Only round types with usable point percentages are shown.</p></section>
      <section className="space-y-4"><h2 className="text-2xl font-semibold">Shared games</h2><p className="text-xs text-zinc-500">Mapped roster coverage: {data.rosterCoverage.mapped}/{data.rosterCoverage.total} recorded roster entries across these games. Counts deduplicate each person within a game.</p><div className="grid gap-6 sm:grid-cols-2"><section className="space-y-3"><h3 className="font-semibold">Frequent teammates</h3><FrequencyList items={data.teammates} /></section><section className="space-y-3"><h3 className="font-semibold">Frequent opponents</h3><FrequencyList items={data.opponents} /></section></div></section>
      <section className="grid gap-4 sm:grid-cols-2"><Extremes label="Best team scores" items={data.bestPoints} /><Extremes label="Lowest team scores" items={data.worstPoints} /><Extremes label="Best points earned (%)" items={data.bestPercentage} percentage /><Extremes label="Lowest points earned (%)" items={data.worstPercentage} percentage /></section>
    </> : <>
      <Cards items={[["Games hosted", data.summary.gamesHosted], ["Points teams earned", statsPercent(data.summary.difficulty), "All included team points divided by all available points. Games with more available points have more weight."], ["Typical team score", statsPercent(data.medianTeamPercentage), `The middle team result after sorting ${data.medianTeamSampleSize} team results by percentage. We average the two middle results when needed. Each team in each game counts once.`], ["Average winner's points", statsNumber(data.summary.averageWinningScore), `Across ${data.summary.gamesWithUniqueWinner} games with one winner. Tied first places are left out.`]]} />
      <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900 dark:bg-emerald-950/20"><h2 className="text-xl font-semibold">How much did teams score?</h2><p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">A score of 60% means teams earned 60 out of every 100 available points. Lower percentages can suggest harder quizzes; they do not rate the host’s skill. Only games with complete, usable scoring are included.</p><Percentage value={data.difficulty} label="Points teams earned" /></section>
    </>}
    <ScoreBars title={role === "host" ? "Team scoring by game" : "Team scores by game"} description={role === "host" ? "Points teams earned out of the available points in each game on this history page. A lower percentage can suggest a harder quiz." : "Your team's final points in each game on this history page. Quiz lengths and scoring rules can differ."} items={historyScoreBars(history, role)} percentage={role === "host"} />
    <section className="space-y-4"><h2 className="text-2xl font-semibold">Game history</h2><HistoryTable data={history} role={role} /></section><PercentageHelp />
  </main>;
}
