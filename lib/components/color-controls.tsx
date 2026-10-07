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
  const saturated = hsvToHex({ ...hsv, s: 100 });
  const gray = hsvToHex({ ...hsv, s: 0 });
  const bright = hsvToHex({ ...hsv, v: 100 });
  const backgrounds = {
    h: "linear-gradient(to bottom, #FF0000 0%, #FFFF00 16.667%, #00FF00 33.333%, #00FFFF 50%, #0000FF 66.667%, #FF00FF 83.333%, #FF0000 100%)",
    s: `linear-gradient(to bottom, ${saturated}, ${gray})`,
    v: `linear-gradient(to bottom, ${bright}, #000000)`,
  };

  return (
    <fieldset disabled={disabled} aria-label="Image color" className="color-picker">
      <div className="color-picker-tracks">
        {(["h", "s", "v"] as const).map((channel) => (
          <label key={channel} className="color-picker-track" style={{ background: backgrounds[channel] }}>
            <span
              aria-hidden="true"
              className="color-picker-handle"
              style={{ top: (() => {
                const fraction = channel === "h" ? hsv.h / 360 : 1 - hsv[channel] / 100;
                return `calc(${fraction * 100}% + ${16 - fraction * 32}px)`;
              })() }}
            />
            <input
              aria-label={{ h: "Hue", s: "Saturation", v: "Value" }[channel]}
              aria-orientation="vertical"
              aria-valuetext={`${Math.round(hsv[channel])}${channel === "h" ? " degrees" : " percent"}`}
              title={{ h: "Hue", s: "Saturation", v: "Value" }[channel]}
              type="range"
              min={0}
              max={channel === "h" ? 360 : 100}
              step={1}
              value={hsv[channel]}
              style={{ direction: channel === "h" ? "ltr" : "rtl" }}
              onChange={(event) => change(channel, Number(event.target.value))}
              onPointerUp={onCommit}
              onPointerCancel={onCommit}
              onKeyUp={onCommit}
              onBlur={onCommit}
            />
          </label>
        ))}
      </div>
      <output className="sr-only">{color}</output>
    </fieldset>
  );
}
