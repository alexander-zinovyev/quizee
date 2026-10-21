"use client";

import { createElement, useId, type ReactElement } from "react";
import type { ColorSvg, SvgNode } from "@/lib/media/color-svg";
import { inheritSvgPaint, SVG_DEFINITIONS, SVG_SHAPES, type SvgPaint, type SvgPaintChannel } from "@/lib/media/color-svg-paint";

export function ColorSvgImage({ artwork, color, original, label, className }: {
  artwork: ColorSvg; color: string; original: boolean; label: string; className: string;
}) {
  const prefix = `color-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  const regions = new Set(artwork.regionIds);
  function render(node: SvgNode, selected: SvgPaintChannel | null = null, inherited?: SvgPaint, key = "root"): ReactElement {
    const paint = inheritSvgPaint(node.attributes, inherited);
    const recolor = original || SVG_DEFINITIONS.has(node.tag) ? null : regions.has(node.attributes.id) ? artwork.regionPaints[node.attributes.id] : selected;
    const props: Record<string, string> = {};
    for (const [attribute, value] of Object.entries(node.attributes)) {
      const name = attribute.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      props[name] = attribute === "id" ? prefix + value : value.startsWith("url(#") ? value.replace("url(#", `url(#${prefix}`) : value;
    }
    if (recolor && paint[recolor] !== "none" && (node.tag === "g" || SVG_SHAPES.has(node.tag))) props[recolor] = color;
    if (key === "root") {
      props.role = "img";
      props["aria-label"] = label;
      props.className = className;
      delete props.width;
      delete props.height;
    }
    // Match an external SVG image's viewport so artwork cannot paint over adjacent controls.
    return createElement(node.tag, { ...props, key, ...(key === "root" ? { style: { aspectRatio: `${artwork.width}/${artwork.height}`, overflow: "hidden" } } : {}) }, node.text, ...node.children.map((child, index) => render(child, recolor, paint, `${key}-${index}`)));
  }
  return render(artwork.root);
}
