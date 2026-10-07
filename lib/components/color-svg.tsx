"use client";

import { createElement, useId, type ReactElement } from "react";
import type { ColorSvg, SvgNode } from "@/lib/media/color-svg";

export function ColorSvgImage({ artwork, color, original, label, className }: {
  artwork: ColorSvg; color: string; original: boolean; label: string; className: string;
}) {
  const prefix = `color-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  const regions = new Set(artwork.regionIds);
  function render(node: SvgNode, selected = false, inheritedFill = "black", key = "root"): ReactElement {
    const fill = !node.attributes.fill || node.attributes.fill === "inherit" ? inheritedFill : node.attributes.fill;
    const recolor = !original && !["defs", "clipPath", "linearGradient", "radialGradient"].includes(node.tag) && (selected || regions.has(node.attributes.id));
    const props: Record<string, string> = {};
    for (const [attribute, value] of Object.entries(node.attributes)) {
      const name = attribute.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      props[name] = attribute === "id" ? prefix + value : value.startsWith("url(#") ? value.replace("url(#", `url(#${prefix}`) : value;
    }
    if (recolor && fill !== "none" && ["g", "path", "rect", "circle", "ellipse", "polygon", "polyline"].includes(node.tag)) props.fill = color;
    if (key === "root") {
      props.role = "img";
      props["aria-label"] = label;
      props.className = className;
      delete props.width;
      delete props.height;
    }
    return createElement(node.tag, { ...props, key, ...(key === "root" ? { style: { aspectRatio: `${artwork.width}/${artwork.height}` } } : {}) }, node.text, ...node.children.map((child, index) => render(child, recolor, fill, `${key}-${index}`)));
  }
  return render(artwork.root);
}
