import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreBars, RoundScoresChart, ResultsChart } from "@/lib/components/stats/charts";
import { playerWinRateBars, scoreRange } from "@/lib/stats/charts";
import { playerSummary } from "./aggregates";
import { calculatePercentage } from "./metrics";

test("chart scales include a real zero baseline, signed scores, and a full percentage denominator", () => {
  assert.deepEqual(scoreRange([-4, 0, 10, null]), { minimum: -4, maximum: 10, span: 14 });
  assert.deepEqual(scoreRange([null, 0]), { minimum: 0, maximum: 0, span: 1 });
  assert.deepEqual(scoreRange([-0.2, 0.6], true), { minimum: -0.2, maximum: 1, span: 1.2 });
});

test("player comparison retains sample sizes, counts ties in played games, and distinguishes zero wins from unknown results", () => {
  const player = (id: string, counters: Record<string, number>) => ({ id, displayName: id, hasPlayerHistory: true, hasHostHistory: false,
    summary: playerSummary(counters), percentage: calculatePercentage([]) });
  const bars = playerWinRateBars([player("Alice", { wins: 1, ties: 1, gamesPlayed: 2, provisionalGames: 1 }), player("Bob", { losses: 3, gamesPlayed: 3 }),
    player("Unknown", { wins: 1, resultsUnavailable: 1, gamesPlayed: 2 })]);
  assert.deepEqual(bars.map((bar) => bar.value), [0.5, 0, null]);
  assert.equal(bars[0].detail, "1 win · 2 games played · 1 provisional game");
  assert.equal(bars[0].href, "/stats/players/Alice");
  assert.equal(bars[1].detail, "0 wins · 3 games played");
});

test("charts retain missing, zero and negative labels and expose nonvisual data", () => {
  const bars = renderToStaticMarkup(createElement(ScoreBars, { title: "Scores", description: "Recorded totals", items: [
    { id: "negative", label: "Negative", value: -4 }, { id: "zero", label: "Zero", value: 0 }, { id: "missing", label: "Missing", value: null },
  ] }));
  assert.match(bars, /-4/); assert.match(bars, /Unavailable/); assert.doesNotMatch(bars, /NaN|Infinity/);
  const rounds = renderToStaticMarkup(createElement(RoundScoresChart, { rounds: [{ id: "a", title: "First" }, { id: "b", title: "Missing" }, { id: "c", title: "Last" }],
    series: [{ id: "team", label: "Team", values: [0, null, -2] }] }));
  assert.match(rounds, /Round scores chart data/); assert.match(rounds, /Team, Last: -2 points/);
  assert.match(rounds, /Unavailable/); assert.doesNotMatch(rounds, /NaN|Infinity/);
  const empty = renderToStaticMarkup(createElement(ResultsChart, { wins: 0, ties: 0, losses: 0, unavailable: 0 }));
  assert.match(empty, /No games yet/); assert.doesNotMatch(empty, /NaN|Infinity/);
});
