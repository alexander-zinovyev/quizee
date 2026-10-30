"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicStatsGameDetail, PublicStatsQuestionPage } from "@/types/stats-public";
import { readJsonResponse } from "@/lib/api-response";
import { statsNumber } from "@/lib/stats/value";
import Percentage from "./percentage";
import StatsStages, { ColorValue } from "./stages";

function Questions({ game, roundId }: { game: PublicStatsGameDetail; roundId: string }) {
  const router = useRouter(), [pages, setPages] = useState<PublicStatsQuestionPage[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const round = game.metrics.rounds.find((round) => round.id === roundId)!;
  const load = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ version: String(game.version), limit: "10" }); if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/stats/games/${encodeURIComponent(game.id)}/rounds/${encodeURIComponent(roundId)}?${params}`, { cache: "no-store", signal });
      if (response.status === 409) { setPages([]); router.refresh(); throw new Error("This game was updated. Reload the current game view."); }
      const page = await readJsonResponse<PublicStatsQuestionPage>(response, "Load questions");
      if (!signal?.aborted) setPages((previous) => cursor ? [...previous, page] : [page]);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Unable to load questions."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [game.id, game.version, roundId, router]);
  useEffect(() => { const controller = new AbortController(); void load(null, controller.signal); return () => controller.abort(); }, [load]);
  const assets = Object.assign({}, ...pages.map((page) => page.assets)) as PublicStatsQuestionPage["assets"];
  const url = (id: string) => `/api/stats/games/${encodeURIComponent(game.id)}/assets/${id}`;
  const items = pages.flatMap((page) => page.items), next = pages.at(-1)?.nextCursor;
  return <div className="space-y-4">{error && <p role="alert" className="text-red-600">{error}</p>}{items.length > 0 && <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{round.title}: questions, accepted answers, and recorded team answers</caption><thead><tr><th className="min-w-56 p-3 text-left" scope="col">Question</th><th className="min-w-56 p-3 text-left" scope="col">Accepted answer</th>{game.teams.map((team) => <th className="min-w-60 p-3 text-left" key={team.id} scope="col">{team.name ?? "Team name unavailable"}</th>)}</tr></thead><tbody>{items.map((question) => <tr className="border-t align-top" key={question.id}>
    <th scope="row" className="p-3 text-left font-normal"><p className="mb-2 font-semibold">Question {question.order + 1}</p><StatsStages stages={question.prompt} assets={assets} assetUrl={url} label="Question media" />{question.color && <p className="mt-2"><ColorValue value={question.color.initialColor} label="Initial color" /></p>}<p className="mt-3 text-xs text-zinc-500">Maximum: {statsNumber(question.maximum.points)} ({question.maximum.provenance === "admin" ? "admin verified" : question.maximum.provenance === "configured" ? "scoring rules" : "unverified assumption"})</p></th>
    <td className="space-y-2 p-3">{question.answerHint && <p className="font-semibold">{question.answerHint}</p>}{question.color ? <ColorValue value={question.color.targetColor} label="Target" /> : <StatsStages stages={question.acceptedAnswer} assets={assets} assetUrl={url} label="Accepted answer media" />}</td>
    {game.teams.map((team) => { const answer = question.answers[team.id]; return <td className="space-y-2 p-3" key={team.id}>{!answer || answer.answer === null ? <p className="text-zinc-500">Not recorded</p> : answer.answer === "" ? <p>Unanswered</p> : question.color ? <ColorValue value={answer.answer} label="Recorded color" /> : round.type === "image" ? answer.assetId ? <StatsStages stages={[{ text: null, assetId: answer.assetId }]} assets={assets} assetUrl={url} label="Submitted image" /> : <p>{answer.answer === "" ? "Unanswered" : "Recorded image unavailable"}</p> : <p className="whitespace-pre-wrap">{answer.answer === "" ? "Unanswered" : answer.answer}</p>}
      <p className="font-semibold">Points: {statsNumber(answer?.awardedPoints)}</p><p className="text-xs">{round.closestPool ? "Color matching result" : answer?.correctness === true ? "Correct" : answer?.correctness === false ? "Incorrect" : "Correctness unavailable"}</p>{answer?.perceptionScore !== null && answer?.perceptionScore !== undefined && <p className="text-xs">Perception: {statsNumber(answer.perceptionScore)} / 10</p>}{answer?.attempts.length > 0 && <details className="text-xs"><summary className="cursor-pointer">Recorded attempts</summary><ol className="mt-2 space-y-1">{answer.attempts.map((attempt) => <li key={attempt.step}>Step {attempt.step + 1}: {attempt.answer}</li>)}</ol></details>}
    </td>; })}
  </tr>)}</tbody></table></div>}{busy && <p role="status">Loading questions…</p>}{next && <button className="rounded-lg border px-4 py-2 text-sm" disabled={busy} onClick={() => void load(next)}>More questions</button>}{!busy && !error && !items.length && <p>Question details were not recorded.</p>}</div>;
}

export default function GameRounds({ game }: { game: PublicStatsGameDetail }) {
  const [active, setActive] = useState<string | null>(null);
  return <section className="space-y-5"><h2 className="text-2xl font-semibold">Rounds and answers</h2>{game.metrics.rounds.map((round) => <article className="space-y-4 rounded-xl border p-5" key={round.id}>
    <h3 className="text-xl font-semibold">{round.title || "Round title unavailable"}</h3>{round.closestPool && <p className="text-sm text-zinc-500">Recorded points count toward final standings. This round is left out of point percentages.</p>}
    <div className="grid gap-4 sm:grid-cols-2">{game.teams.map((team) => { const result = round.teams[team.id]; return <section key={team.id} className="rounded-lg bg-zinc-100 p-4 dark:bg-zinc-900"><h4 className="font-semibold">{team.name ?? "Team name unavailable"}: {statsNumber(result?.score)} points</h4>{result && <>{!round.closestPool && <Percentage value={result.percentage} label="Points earned" />}<p className="mt-2 text-xs text-zinc-500">{result.answers.recorded}/{result.answers.total} answer records; {result.answers.unanswered} known blanks; {result.answers.incorrect} incorrect among {result.answers.knownCorrectness} known correctness records.</p>{result.reconciliation.status === "mismatch" && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Unexplained round-score difference: {statsNumber(result.reconciliation.difference)}.</p>}</>}</section>; })}</div>
    <button className="text-sm font-semibold text-emerald-700 underline dark:text-emerald-400" aria-expanded={active === round.id} onClick={() => setActive(active === round.id ? null : round.id)}>{active === round.id ? "Hide questions" : "Show questions and answers"}</button>{active === round.id && <Questions key={`${game.version}:${round.id}`} game={game} roundId={round.id} />}
  </article>)}{!game.metrics.rounds.length && <p>Round details are unavailable for this historical game.</p>}</section>;
}
