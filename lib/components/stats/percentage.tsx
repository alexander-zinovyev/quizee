import type { StatsPercentage } from "@/types/stats";
import { statsNumber, statsPercent } from "@/lib/stats/value";

const exclusionLabels: Record<string, string> = {
  "closest-pool": "Rounds scored relative to other teams",
  "unknown-scoring": "Scoring rules unavailable", "missing-award": "Points not recorded",
  "unverified-maximum": "Maximum points unverified", "zero-maximum": "No available points",
  "award-exceeds-maximum": "Award exceeds the recorded maximum", "unreconciled-score": "Recorded scores do not add up",
  "incomplete-game": "Incomplete game detail",
};

export default function Percentage({ value, label }: { value: StatsPercentage; label?: string }) {
  const c = value.coverage;
  return <div className="space-y-1"><p className="font-semibold">{label && <span>{label}: </span>}{statsPercent(value.value)}</p>
    <p className="text-xs text-zinc-600 dark:text-zinc-400">{statsNumber(value.numerator)} of {statsNumber(value.denominator)} available points earned. Includes {c.eligibleQuestionTeams} of {c.totalQuestionTeams} team answers.</p>
    {c.provisionalGames > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Includes {c.provisionalGames} game(s) with incomplete grading at publication.</p>}
    {Object.keys(c.excluded).length > 0 && <details className="text-xs"><summary className="cursor-pointer">What’s left out?</summary><ul className="mt-2 list-inside list-disc">{Object.entries(c.excluded).map(([reason, count]) => <li key={reason}>{exclusionLabels[reason] ?? reason.replaceAll("-", " ")}: {count} team answers</li>)}</ul></details>}
  </div>;
}

export function PercentageHelp() {
  return <details className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-700"><summary className="cursor-pointer font-semibold">How these statistics work</summary><div className="mt-3 space-y-2">
    <p>Percentages divide known earned points by the maximum for those same questions. Missing inputs and unexplained score differences are excluded. Negative scores and percentages are preserved.</p>
    <p>Player points are team points in games played. Every rostered player gets the same participation measure; these are not individual scores.</p>
    <p>Rounds scored relative to other teams are left out of point percentages. Their recorded points still count in team totals and final standings.</p>
    <p>On host profiles, “Points teams earned” combines earned and available points across games. “Typical team score” is the middle team percentage after sorting the results, averaging the two middle values when needed. Lower percentages may suggest harder quizzes; they do not rate host skill or content quality. Check how many results are included.</p>
    <p>Published scores stay frozen. Results with incomplete grading remain provisional even if the original room is graded later.</p>
  </div></details>;
}
