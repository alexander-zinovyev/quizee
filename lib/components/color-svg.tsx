"use client";

import Color from "colorjs.io";
import { createElement, useId, type ReactElement } from "react";
import type { ColorSvg, SvgNode } from "@/lib/media/color-svg";
import { inheritSvgPaint, SVG_DEFINITIONS, SVG_SHAPES, type SvgPaint, type SvgPaintChannel } from "@/lib/media/color-svg-paint";

function renderColorSvg(artwork: ColorSvg, prefix: string, { color, original = false, mask = false, label = "", className = "" }: {
  color: string; original?: boolean; mask?: boolean; label?: string; className?: string;
}) {
  const regions = new Set(artwork.regionIds);
  function maskPaint(value: string, paint: SvgPaint) {
    if (value === "none") return "none";
    if (value.startsWith("url(#")) return value.replace("url(#", `url(#${prefix}`);
    return `rgba(0, 0, 0, ${new Color(value === "currentColor" ? paint.color : value).alpha})`;
  }
  function render(node: SvgNode, selected: SvgPaintChannel | null = null, inherited?: SvgPaint, key = "root", inheritedStopColor = "black"): ReactElement {
    const paint = inheritSvgPaint(node.attributes, inherited);
    const stopColor = !node.attributes["stop-color"] || node.attributes["stop-color"] === "inherit" ? inheritedStopColor : node.attributes["stop-color"];
    const recolor = original || SVG_DEFINITIONS.has(node.tag) ? null : regions.has(node.attributes.id) ? artwork.regionPaints[node.attributes.id] : selected;
    const props: Record<string, string> = {};
    for (const [attribute, value] of Object.entries(node.attributes)) {
      const name = attribute.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      props[name] = attribute === "id" ? prefix + value : value.startsWith("url(#") ? value.replace("url(#", `url(#${prefix}`) : value;
    }
    if (recolor && paint[recolor] !== "none" && (node.tag === "g" || SVG_SHAPES.has(node.tag))) props[recolor] = color;
    if (mask && SVG_SHAPES.has(node.tag)) {
      // Preserve geometry, clipping, occlusion and opacity, highlighting only the editable paint channel.
      for (const channel of ["fill", "stroke"] as const) props[channel] = recolor === channel && paint[channel] !== "none" ? "white" : maskPaint(paint[channel], paint);
    }
    if (mask && node.tag === "stop") props.stopColor = maskPaint(stopColor, paint);
    if (key === "root" && !mask) {
      props.role = "img";
      props["aria-label"] = label;
      props.className = className;
      delete props.width;
      delete props.height;
    }
    if (key === "root" && mask) {
      for (const attribute of ["xmlns", "viewBox", "width", "height", "preserveAspectRatio"]) delete props[attribute];
    }
    // Match an external SVG image's viewport so artwork cannot paint over adjacent controls.
    return createElement(key === "root" && mask ? "g" : node.tag, { ...props, key, ...(key === "root" && !mask ? { style: { aspectRatio: `${artwork.width}/${artwork.height}`, overflow: "hidden" } } : {}) }, node.text, ...node.children.map((child, index) => render(child, recolor, paint, `${key}-${index}`, stopColor)));
  }
  return render(artwork.root);
}

export function ColorSvgImage({ artwork, color, original, label, className }: {
  artwork: ColorSvg; color: string; original: boolean; label: string; className: string;
}) {
  const prefix = `color-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  return renderColorSvg(artwork, prefix, { color, original, label, className });
}

export function ColorSvgMask({ artwork }: { artwork: ColorSvg }) {
  const prefix = `color-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  return renderColorSvg(artwork, prefix, { color: "white", mask: true });
}
