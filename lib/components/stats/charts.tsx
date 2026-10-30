"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { statsNumber, statsPercent } from "@/lib/stats/value";
import { scoreRange, type ChartBar } from "@/lib/stats/charts";

const colors = ["#059669", "#7c3aed", "#0284c7", "#d97706", "#e11d48", "#475569"];

function ChartFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  return <figure aria-labelledby={id} className="min-w-0 space-y-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
    <figcaption><h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">{description}</p></figcaption>{children}
  </figure>;
}

/** A shared zero baseline preserves negative values; missing scores never become zero. */
export function ScoreBars({ title, description, items, percentage = false }: { title: string; description: string; items: ChartBar[]; percentage?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { minimum, span } = scoreRange(items.map(({ value }) => value), percentage);
  const format = percentage ? statsPercent : statsNumber;
  return <ChartFrame title={title} description={description}>{!items.length ? <p className="py-6 text-sm text-zinc-500">No results to chart yet.</p> : <ol className="space-y-5">{(expanded ? items : items.slice(0, 6)).map((item, index) => <li key={item.id} className="min-w-0">
    <div className="mb-2 flex items-start justify-between gap-4 text-sm"><span className="min-w-0 break-words font-medium">{item.href ? <Link className="decoration-emerald-500 underline-offset-4 hover:underline focus-visible:underline" href={item.href}>{item.label}</Link> : item.label}{item.detail && <span className="mt-1 block text-xs font-normal text-zinc-500 dark:text-zinc-400">{item.detail}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{format(item.value)}{!percentage && item.value !== null && <span className="font-normal text-zinc-500"> pts</span>}</span></div>
    <div className="relative h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true"><span className="absolute inset-y-0 w-px bg-zinc-400" style={{ left: `${-minimum / span * 100}%` }} />{item.value !== null && <span className="absolute inset-y-0 rounded-full" style={{ backgroundColor: item.value < 0 ? "#e11d48" : colors[index % colors.length], left: `${(Math.min(0, item.value) - minimum) / span * 100}%`, width: `${Math.abs(item.value) / span * 100}%` }} />}</div>
  </li>)}</ol>}{items.length > 6 && <button className="text-sm font-semibold text-emerald-700 underline dark:text-emerald-400" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer results" : `Show all ${items.length} results on this page`}</button>}</ChartFrame>;
}

export function ResultsChart({ wins, ties, losses, unavailable }: { wins: number; ties: number; losses: number; unavailable: number }) {
  const items = [{ label: "Wins", value: wins, color: colors[0] }, { label: "Ties", value: ties, color: colors[2] },
    { label: "Losses", value: losses, color: colors[4] }, { label: "Unknown results", value: unavailable, color: colors[5] }];
  const total = wins + ties + losses + unavailable;
  return <ChartFrame title="Results at a glance" description="Your team's finish in every published game linked to this profile.">
    <div className="flex h-8 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">{items.map((item) => item.value > 0 && <span key={item.label} style={{ width: `${item.value / total * 100}%`, backgroundColor: item.color }} />)}</div>
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{items.map((item) => <div key={item.label}><dt className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{item.value}<span className="ml-2 text-xs font-normal text-zinc-500">{total ? statsPercent(item.value / total) : "No games yet"}</span></dd></div>)}</dl>
  </ChartFrame>;
}

export type RoundChartSeries = { id: string; label: string; values: Array<number | null> };

export function RoundScoresChart({ rounds, series }: { rounds: Array<{ id: string; title: string }>; series: RoundChartSeries[] }) {
  const [hidden, setHidden] = useState<string[]>([]), [selected, setSelected] = useState(0);
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(752);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const plotWidth = Math.max(280, width, rounds.length * 20 + 56);
  const known = series.flatMap(({ values }) => values.flatMap((value) => value === null ? [] : [value]));
  const { minimum, span } = scoreRange(known);
  const x = (index: number) => 40 + index * (plotWidth - 60) / Math.max(1, rounds.length - 1);
  const y = (value: number) => 224 - (value - minimum) / span * 192;
  const active = series.filter(({ id }) => !hidden.includes(id));
  const ticks = [...new Set([minimum, minimum + span / 2, minimum + span, 0])].sort((a, b) => a - b);
  return <ChartFrame title="Round scores" description="See where each team gained ground. Select a point to inspect a round, or use the team buttons to show and hide lines. Gaps mean a score wasn't recorded.">
    {!rounds.length || !known.length ? <p className="py-6 text-sm text-zinc-500">Round scores are unavailable for this game.</p> : <>
      <div className="flex flex-wrap gap-2">{series.map((team, index) => <button key={team.id} aria-pressed={!hidden.includes(team.id)} onClick={() => setHidden((previous) => previous.includes(team.id) ? previous.filter((id) => id !== team.id) : [...previous, team.id])} className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm aria-[pressed=false]:opacity-40"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />{team.label}</button>)}</div>
      <div ref={container} className="overflow-x-auto"><svg viewBox={`0 0 ${plotWidth} 260`} height="260" style={{ width: plotWidth }} role="group" aria-label="Round scores chart" className="overflow-visible">
        {ticks.map((value) => <g key={value}><line x1="40" x2={plotWidth - 20} y1={y(value)} y2={y(value)} className="stroke-zinc-200 dark:stroke-zinc-700" strokeDasharray={value === 0 ? undefined : "3 5"} /><text x="30" y={y(value) + 4} textAnchor="end" className="fill-zinc-500 text-[12px] dark:fill-zinc-400">{statsNumber(value)}</text></g>)}
        {rounds.map((round, index) => <text key={round.id} x={x(index)} y="251" textAnchor="middle" className="fill-zinc-500 text-[12px] dark:fill-zinc-400">{index + 1}</text>)}
        {series.map((team, teamIndex) => !hidden.includes(team.id) && <g key={team.id} style={{ color: colors[teamIndex % colors.length] }}>
          <path d={team.values.map((value, index) => value === null ? "" : `${index === 0 || team.values[index - 1] === null ? "M" : "L"}${x(index)},${y(value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          {team.values.map((value, index) => value !== null && <circle key={rounds[index].id} cx={x(index)} cy={y(value)} r={selected === index ? 6 : 4} fill="currentColor" stroke="currentColor" strokeWidth="10" strokeOpacity="0.12" tabIndex={0} role="button" aria-label={`${team.label}, ${rounds[index].title || `Round ${index + 1}`}: ${statsNumber(value)} points`} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4" onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(index); } }}><title>{`${team.label}: ${statsNumber(value)} points`}</title></circle>)}
        </g>)}
      </svg></div>
      <div className="rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-950" aria-live="polite"><p className="font-semibold">Round {selected + 1}: {rounds[selected]?.title || "Untitled round"}</p><ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{active.map((team) => <li key={team.id}>{team.label}: <strong className="tabular-nums">{team.values[selected] === null ? "Not recorded" : `${statsNumber(team.values[selected])} points`}</strong></li>)}</ul>{!active.length && <p className="mt-2 text-zinc-500">Select a team above to see its scores.</p>}</div>
      <details className="text-sm"><summary className="cursor-pointer text-zinc-500">View chart data</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Round scores chart data</caption><thead><tr><th scope="col" className="p-2">Round</th>{series.map((team) => <th scope="col" className="p-2" key={team.id}>{team.label}</th>)}</tr></thead><tbody>{rounds.map((round, index) => <tr key={round.id} className="border-t"><th scope="row" className="p-2 font-normal">{round.title || `Round ${index + 1}`}</th>{series.map((team) => <td className="p-2 tabular-nums" key={team.id}>{statsNumber(team.values[index])}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </ChartFrame>;
}
