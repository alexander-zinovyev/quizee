"use client";

import { useEffect, useRef } from "react";

export function ColorImageIndicator({ version, hidden = false }: {
  version: "team" | "original";
  hidden?: boolean;
}) {
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const indicator = label.current;
    const container = indicator?.parentElement;
    const image = container?.querySelector("canvas, svg");
    if (!indicator || !container || !(image instanceof HTMLCanvasElement || image instanceof SVGSVGElement)) return;
    const update = () => {
      const frame = container.getBoundingClientRect();
      const bounds = image.getBoundingClientRect();
      const ratio = image instanceof HTMLCanvasElement ? image.width / image.height : image.viewBox.baseVal.width / image.viewBox.baseVal.height;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      let width = Math.min(bounds.width, bounds.height * ratio);
      let height = width / ratio;
      let x = (bounds.width - width) / 2, y = (bounds.height - height) / 2;
      if (image instanceof SVGSVGElement) {
        const aspect = image.preserveAspectRatio.baseVal;
        if (aspect.align === 1 || aspect.meetOrSlice === 2) { width = bounds.width; height = bounds.height; x = 0; y = 0; }
        else { x = (bounds.width - width) * ((aspect.align - 2) % 3) / 2; y = (bounds.height - height) * Math.floor((aspect.align - 2) / 3) / 2; }
      }
      // Anchor labels to the artwork, including when its element is letterboxed.
      indicator.style.top = `${bounds.top - frame.top + y + 8}px`;
      if (version === "team") indicator.style.left = `${bounds.left - frame.left + x + 8}px`;
      else indicator.style.right = `${frame.right - bounds.right + (bounds.width - width - x) + 8}px`;
      indicator.style.visibility = "visible";
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(image);
    return () => observer.disconnect();
  }, [version]);
  return (
    <span
      ref={label}
      style={{ visibility: "hidden" }}
      hidden={hidden}
      data-color-indicator={version}
      className={`pointer-events-none absolute top-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white ${version === "team" ? "left-2" : "right-2"}`}
    >
      {version === "team" ? "Team" : "Original"}
    </span>
  );
}
