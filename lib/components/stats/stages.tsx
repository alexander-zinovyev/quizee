"use client";
import StageMedia from "@/lib/components/room/stage-media";
import type { StatsStage } from "@/types/stats";
import { useState } from "react";

function Asset({ url, filename, label }: { url: string; filename: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="text-zinc-500">Media unavailable</span> : <StageMedia url={url} fallbackName={filename} alt={label} mediaVolume={0.2} playbackActive={false} onError={() => setFailed(true)} imageClassName="max-h-52 max-w-full object-contain" videoClassName="max-h-52 max-w-full" audioClassName="max-w-full" />;
}

export default function StatsStages({ stages, assets, assetUrl, label }: { stages: StatsStage[]; assets: Record<string, { filename: string }>; assetUrl: (id: string) => string; label: string }) {
  if (!stages.length) return <span className="text-zinc-500">Not recorded</span>;
  return <ol className="space-y-3">{stages.map((stage, index) => <li key={index} className="space-y-2">
    {stages.length > 1 && <p className="text-xs font-semibold text-zinc-500">Stage {index + 1}</p>}{stage.text !== null && <p className="whitespace-pre-wrap">{stage.text || "Blank"}</p>}
    {stage.assetId && (assets[stage.assetId] ? <Asset key={stage.assetId} url={assetUrl(stage.assetId)} filename={assets[stage.assetId].filename} label={label} /> : <span className="text-zinc-500">Media unavailable</span>)}
  </li>)}</ol>;
}

export function ColorValue({ value, label }: { value: string | null; label: string }) {
  return <span className="inline-flex items-center gap-2">{label}: {value ? <><span className="inline-block h-5 w-5 rounded border border-zinc-400" style={{ backgroundColor: value }} aria-hidden="true" /><span>{value}</span></> : "Not recorded"}</span>;
}
