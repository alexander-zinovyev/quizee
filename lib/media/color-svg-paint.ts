export type SvgPaint = { fill: string; stroke: string; color: string };
export type SvgPaintChannel = "fill" | "stroke";
export const DEFAULT_SVG_PAINT: SvgPaint = { fill: "black", stroke: "none", color: "black" };
export const SVG_SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);
export const SVG_DEFINITIONS = new Set(["defs", "clipPath", "linearGradient", "radialGradient"]);

export function inheritSvgPaint(attributes: Record<string, string>, inherited = DEFAULT_SVG_PAINT): SvgPaint {
  const property = (name: keyof SvgPaint) => !attributes[name] || attributes[name] === "inherit" ? inherited[name] : attributes[name];
  const color = property("color");
  return { fill: property("fill"), stroke: property("stroke"), color: color === "currentColor" ? inherited.color : color };
}

export function svgPaintColor(value: string, paint: SvgPaint): string {
  return value === "currentColor" ? paint.color : value;
}
