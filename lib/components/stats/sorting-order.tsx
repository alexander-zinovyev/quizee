"use client";

import type { StatsQuestion } from "@/types/stats";
import StatsStages from "./stages";

export default function SortingOrder({ sorting, order, assets, assetUrl, label, compare = false }: {
  sorting: NonNullable<StatsQuestion["sorting"]>;
  order: string[];
  assets: Record<string, { filename: string }>;
  assetUrl: (id: string) => string;
  label: string;
  compare?: boolean;
}) {
  return <ol aria-label={label} className="space-y-3">{order.map((id, index) => {
    const item = sorting.items.find((item) => item.id === id);
    if (!item) throw new Error("Sorting history references an unknown item.");
    const correct = sorting.correctOrder[index] === id;
    return <li key={id} className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-semibold">Position {index + 1}{compare && (correct ? " · Correct position" : ` · Correct position: ${sorting.correctOrder.indexOf(id) + 1}`)}</p>
      <StatsStages stages={item.stages} assets={assets} assetUrl={assetUrl} label={`${label}, item ${index + 1}`} />
    </li>;
  })}</ol>;
}
