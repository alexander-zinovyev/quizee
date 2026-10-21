import type { SvgNode } from "./color-svg";
import { SVG_SHAPES } from "./color-svg-paint";

export function svgPixelLength(value: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value.trim())) throw new Error("SVG dimensions and use offsets require numeric or px lengths.");
  const number = Number(value.trim().replace(/px$/i, ""));
  if (!Number.isFinite(number)) throw new Error("SVG lengths must be finite.");
  return number;
}

export function normalizeSvg(root: SvgNode, ids: Map<string, SvgNode>): SvgNode {
  const occupied = new Set(ids.keys());
  let instances = 0;
  let count = 0;
  const unique = (candidate: string) => {
    let id = candidate;
    for (let suffix = 1; occupied.has(id); suffix++) id = `${candidate}-${suffix}`;
    occupied.add(id);
    return id;
  };
  // Each use gets its own IDs and local references so recoloring cannot affect another instance.
  function instance(node: SvgNode): SvgNode {
    const prefix = `use-${++instances}-`;
    const remap = new Map<string, string>();
    function collect(node: SvgNode) {
      if (node.attributes.id) remap.set(node.attributes.id, unique(prefix + node.attributes.id));
      node.children.forEach(collect);
    }
    collect(node);
    function copy(node: SvgNode): SvgNode {
      const attributes = Object.fromEntries(Object.entries(node.attributes).map(([name, value]) => {
        if (name === "id") return [name, remap.get(value)!];
        const reference = /^url\(#(.+)\)$/.exec(value);
        return [name, reference && remap.has(reference[1]) ? `url(#${remap.get(reference[1])})` : value];
      }));
      return { ...node, attributes, children: node.children.map(copy) };
    }
    return copy(node);
  }
  function expand(node: SvgNode, depth: number, ancestors: Set<string>): SvgNode {
    if (++count > 5000 || depth > 64) throw new Error("SVG is too complex after expanding local use references.");
    if (node.tag !== "use") return { ...node, attributes: { ...node.attributes }, children: node.children.map((child) => expand(child, depth + 1, ancestors)) };
    const id = node.attributes.href.slice(1);
    const target = ids.get(id);
    if (!target || ![...SVG_SHAPES, "g", "use"].includes(target.tag)) throw new Error(`Invalid SVG use reference: ${id}.`);
    if (ancestors.has(id)) throw new Error("Cyclic SVG use references are unsupported.");
    const attributes = { ...node.attributes };
    const x = svgPixelLength(attributes.x ?? "0"), y = svgPixelLength(attributes.y ?? "0");
    for (const name of ["href", "x", "y", "width", "height"]) delete attributes[name];
    if (x || y) attributes.transform = `${attributes.transform ?? ""} translate(${x} ${y})`.trim();
    if (node.children.some((child) => !["title", "desc"].includes(child.tag))) throw new Error("SVG use children must be descriptions.");
    const descriptions = node.children.map((child) => expand(child, depth + 1, ancestors));
    const child = expand(target, depth + 1, new Set([...ancestors, id]));
    return { tag: "g", attributes, children: [...descriptions, instance(child)] };
  }
  return expand(root, 0, new Set());
}
