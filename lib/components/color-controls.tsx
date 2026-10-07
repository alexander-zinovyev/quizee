"use client";

import { useState } from "react";
import { hexToHsv, hsvToHex, type HSV } from "@/lib/color";

export function ColorControls({ color, disabled, onChange, onCommit }: {
  color: string; disabled: boolean; onChange: (hex: string) => void; onCommit: () => void;
}) {
  const [state, setState] = useState(() => ({ color, hsv: hexToHsv(color) }));
  if (state.color !== color) setState({ color, hsv: hexToHsv(color) });
  const hsv = state.color === color ? state.hsv : hexToHsv(color);
  function change(channel: keyof HSV, value: number) {
    const next = { ...hsv, [channel]: value };
    const hex = hsvToHex(next);
    setState({ color: hex, hsv: next });
    onChange(hex);
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-5 p-4 disabled:opacity-60">
    {(["h", "s", "v"] as const).map((channel) => <label key={channel} className="block">
      <span className="mb-2 flex justify-between gap-3 text-sm"><span>{{ h: "Hue", s: "Saturation", v: "Value" }[channel]}</span><span>{Math.round(hsv[channel])}{channel === "h" ? "°" : "%"}</span></span>
      <input aria-label={{ h: "Hue", s: "Saturation", v: "Value" }[channel]} type="range" min={0} max={channel === "h" ? 360 : 100} step={1} value={hsv[channel]}
        onChange={(event) => change(channel, Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit}
        className="h-6 w-full accent-emerald-500" />
    </label>)}
    <div className="flex items-center gap-3"><span aria-label={color} className="h-8 w-8 shrink-0 rounded border border-zinc-400" style={{ backgroundColor: color }} /><output className="font-mono text-sm">{color}</output></div>
  </fieldset>;
}
