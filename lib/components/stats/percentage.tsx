import type { StatsPercentage } from "@/types/stats";
import { statsNumber, statsPercent } from "@/lib/stats/value";

export default function Percentage({ value, label }: { value: StatsPercentage; label?: string }) {
  const c = value.coverage;
  return <div className="space-y-1"><p className="font-semibold">{label && <span>{label}: </span>}{statsPercent(value.value)}</p>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{statsNumber(value.numerator)} / {statsNumber(value.denominator)} paired points; {c.eligibleQuestionTeams} / {c.totalQuestionTeams} scored question entries.</p>
    {c.provisionalGames > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Includes {c.provisionalGames} game(s) with incomplete grading at publication.</p>}
    {Object.keys(c.excluded).length > 0 && <details className="text-xs"><summary className="cursor-pointer">Coverage exclusions</summary><ul className="mt-2 list-inside list-disc">{Object.entries(c.excluded).map(([reason, count]) => <li key={reason}>{reason.replaceAll("-", " ")}: {count}</li>)}</ul></details>}
  </div>;
}

export function PercentageHelp() {
  return <details className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-700"><summary className="cursor-pointer font-semibold">How these statistics work</summary><div className="mt-3 space-y-2">
    <p>Percentages divide known earned points by the maximum for those same questions. Missing inputs and unexplained score differences are excluded. Negative scores and percentages are preserved.</p>
    <p>Player points are team points in games played. Every rostered player gets the same participation measure; these are not individual scores.</p>
    <p>Closest-color rounds share a competitive point pool. Their pool shares are shown separately from comparable percentages and host difficulty.</p>
    <p>Host difficulty pools comparable points across games. Lower shares may suggest harder quizzes; they do not measure host skill or content quality. Check the sample size and coverage.</p>
    <p>Published scores stay frozen. Results with incomplete grading remain provisional even if the original room is graded later.</p>
  </div></details>;
}
