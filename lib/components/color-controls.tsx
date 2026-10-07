"use client";

import { useRef, useState } from "react";
import { hexToHsv, hsvToHex, type HSV } from "@/lib/color";

const adjustmentKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function ColorControls({ color, disabled, onChange, onCommit, onCancel }: {
  color: string; disabled: boolean; onChange: (hex: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  const pointer = useRef<number | null>(null);
  const dragStart = useRef<{ color: string; hsv: HSV } | null>(null);
  const [state, setState] = useState(() => ({ color, hsv: hexToHsv(color) }));
  if (state.color !== color) setState({ color, hsv: hexToHsv(color) });
  const hsv = state.color === color ? state.hsv : hexToHsv(color);
  function change(channel: keyof HSV, value: number) {
    const next = { ...hsv, [channel]: value };
    const hex = hsvToHex(next);
    setState({ color: hex, hsv: next });
    onChange(hex);
  }
  function cancel() {
    pointer.current = null;
    if (dragStart.current) setState(dragStart.current);
    dragStart.current = null;
    onCancel();
  }
  const saturated = hsvToHex({ ...hsv, s: 100 });
  const gray = hsvToHex({ ...hsv, s: 0 });
  const bright = hsvToHex({ ...hsv, v: 100 });
  const backgrounds = {
    h: "linear-gradient(to right, #FF0000 0%, #FFFF00 16.667%, #00FF00 33.333%, #00FFFF 50%, #0000FF 66.667%, #FF00FF 83.333%, #FF0000 100%)",
    s: `linear-gradient(to right, ${gray}, ${saturated})`,
    v: `linear-gradient(to right, #000000, ${bright})`,
  };

  return (
    <fieldset disabled={disabled} aria-label="Image color" className="color-picker">
      <div className="color-picker-tracks">
        {(["h", "s", "v"] as const).map((channel) => (
          <label key={channel} className="color-picker-track" style={{ background: backgrounds[channel] }}>
            <span
              aria-hidden="true"
              className="color-picker-handle"
              style={{ left: (() => {
                const fraction = hsv[channel] / (channel === "h" ? 360 : 100);
                return `calc(${fraction * 100}% + ${16 - fraction * 32}px)`;
              })() }}
            />
            <input
              aria-label={{ h: "Hue", s: "Saturation", v: "Value" }[channel]}
              aria-orientation="horizontal"
              aria-valuetext={`${Math.round(hsv[channel])}${channel === "h" ? " degrees" : " percent"}`}
              title={{ h: "Hue", s: "Saturation", v: "Value" }[channel]}
              type="range"
              min={0}
              max={channel === "h" ? 360 : 100}
              step={1}
              value={hsv[channel]}
              onChange={(event) => change(channel, Number(event.target.value))}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                pointer.current = event.pointerId;
                dragStart.current = { color, hsv };
                // Keep the release event on this slider even when the drag leaves its bounds.
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                if (pointer.current !== event.pointerId) return;
                pointer.current = null;
                dragStart.current = null;
                onCommit();
              }}
              onPointerCancel={(event) => { if (pointer.current === event.pointerId) cancel(); }}
              onLostPointerCapture={(event) => { if (pointer.current === event.pointerId) cancel(); }}
              onKeyUp={(event) => { if (pointer.current === null && adjustmentKeys.has(event.key)) onCommit(); }}
              onBlur={() => { if (pointer.current === null) onCommit(); }}
            />
          </label>
        ))}
      </div>
      <output className="sr-only">{color}</output>
    </fieldset>
  );
}
