import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreBars, RoundScoresChart, ResultsChart } from "@/lib/components/stats/charts";
import { gameScoreBars, scoreRange } from "@/lib/stats/charts";
import { normalizeRoomSource } from "./source";
import { roomSourceFixture } from "./source.fixtures";
import type { PublicStatsGame } from "@/types/stats";

test("chart scales include a real zero baseline, signed scores, and a full percentage denominator", () => {
  assert.deepEqual(scoreRange([-4, 0, 10, null]), { minimum: -4, maximum: 10, span: 14 });
  assert.deepEqual(scoreRange([null, 0]), { minimum: 0, maximum: 0, span: 1 });
  assert.deepEqual(scoreRange([-0.2, 0.6], true), { minimum: -0.2, maximum: 1, span: 1.2 });
});

test("a partially recorded game has an unknown top score, and all-negative games keep their highest negative score", () => {
  const snapshot = normalizeRoomSource(roomSourceFixture(), "charts");
  const game: PublicStatsGame = { ...snapshot, version: 1, publishedAt: snapshot.snapshotAt, provisional: false, unresolvedAppearances: 0,
    host: null, teams: snapshot.teams.map((team, index) => ({ ...team, score: index ? -5 : -2, outcome: index ? "loss" : "win", rank: index + 1 })) };
  assert.equal(gameScoreBars([game])[0].value, -2);
  game.teams[0].score = null;
  assert.equal(gameScoreBars([game])[0].value, null);
  game.teams = [];
  assert.equal(gameScoreBars([game])[0].value, null);
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
