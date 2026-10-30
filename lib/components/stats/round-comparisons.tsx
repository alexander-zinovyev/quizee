import { ArrowLeftRight, Flame, Target, Trophy } from "lucide-react";
import type { PublicStatsGameDetail } from "@/types/stats-public";
import { statsNumber } from "@/lib/stats/value";

export default function RoundComparisons({ game }: { game: PublicStatsGameDetail }) {
  const comparisons = game.metrics.comparisons;
  const roundName = (id: string) => game.metrics.rounds.find((round) => round.id === id)?.title || "Untitled round";
  const teamName = (id: string) => game.teams.find((team) => team.id === id)?.name || "Unnamed team";
  const closest = comparisons.closestRounds.map((id) => {
    const scores = Object.values(game.metrics.rounds.find((round) => round.id === id)!.teams).flatMap(({ score }) => score === null ? [] : [score]);
    return { label: roundName(id), detail: `${statsNumber(Math.max(...scores) - Math.min(...scores))} points from first to last` };
  });
  const cards = [
    { title: "Closest contest", icon: Target, color: "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50", items: closest, empty: "Not enough recorded team scores to compare." },
    { title: "Biggest gap", icon: ArrowLeftRight, color: "text-violet-700 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/50", items: comparisons.largestSwings.map((item) => ({ label: `${statsNumber(item.change)} points`, detail: `${roundName(item.roundId)} · ${item.teams.map(teamName).join(" / ")}` })), empty: "Not enough recorded team scores to compare." },
    { title: "Standout score", icon: Trophy, color: "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/50", items: comparisons.highestRoundTeams.map((item) => ({ label: `${statsNumber(item.score)} points · ${teamName(item.teamId)}`, detail: roundName(item.roundId) })), empty: "No round scores recorded yet." },
    { title: "Toughest result", icon: Flame, color: "text-sky-700 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/50", items: comparisons.lowestRoundTeams.map((item) => ({ label: `${statsNumber(item.score)} points · ${teamName(item.teamId)}`, detail: roundName(item.roundId) })), empty: "No round scores recorded yet." },
  ];
  return <section className="space-y-4"><div><h2 className="text-2xl font-semibold">Round comparisons</h2><p className="mt-1 text-sm text-zinc-500">The tight finishes and standout scores. Raw points vary with each round’s scoring rules.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{cards.map(({ title, icon: Icon, color, items, empty }) => <article key={title} className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><div className="mb-4 flex items-center gap-3"><span className={`rounded-xl p-2.5 ${color}`}><Icon aria-hidden="true" className="h-5 w-5" /></span><h3 className="font-semibold">{title}</h3></div>{items.length ? <ul className="space-y-3">{items.map((item, index) => <li key={index}><p className="break-words text-lg font-semibold tracking-tight">{item.label}</p><p className="mt-1 break-words text-sm text-zinc-500 dark:text-zinc-400">{item.detail}</p></li>)}</ul> : <p className="text-sm text-zinc-500">{empty}</p>}</article>)}</div>
  </section>;
}
