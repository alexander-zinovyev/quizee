import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import Color from "colorjs.io";
import { parseRegionIds, SVG_REGION_ID } from "@/types/color";
import { parseSvgStyle, parseSvgStyleValue, SVG_STYLE_PROPERTIES } from "./color-svg-style";
import { normalizeSvg, svgPixelLength } from "./color-svg-normalize";
import { inheritSvgPaint, svgPaintColor, SVG_DEFINITIONS, SVG_SHAPES, type SvgPaint, type SvgPaintChannel } from "./color-svg-paint";

export type SvgNode = { tag: string; attributes: Record<string, string>; children: SvgNode[]; text?: string };
export type ColorSvg = { kind: "svg"; root: SvgNode; width: number; height: number; regionIds: string[]; eligibleRegionIds: string[]; regionPaints: Record<string, SvgPaintChannel> };

const namespace = "http://www.w3.org/2000/svg";
const xlinkNamespace = "http://www.w3.org/1999/xlink";
const tags = new Set(["svg", "g", ...SVG_SHAPES, "use", "defs", "clipPath", "linearGradient", "radialGradient", "stop", "title", "desc"]);
const attributes = new Set(["xmlns", "xmlns:xlink", "xml:space", "href", "xlink:href", "viewBox", "width", "height", "id", "version", "preserveAspectRatio", ...SVG_STYLE_PROPERTIES, "transform", "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "clipPathUnits", "gradientUnits", "gradientTransform", "spreadMethod", "offset", "fx", "fy", "fr"]);

export function parseColorSvg(source: string, selectedIds?: string[]): ColorSvg {
  if (!source.trim() || new TextEncoder().encode(source).length > 1024 * 1024) throw new Error("SVG must be nonempty and at most 1 MiB.");
  const document = new DOMParser({ onError: (_level, message) => { throw new Error(`Invalid SVG XML: ${message}`); } }).parseFromString(source, "image/svg+xml");
  if (document.doctype) throw new Error("SVG document types are unsupported.");
  const element = document.documentElement;
  if (!element || element.tagName !== "svg" || element.namespaceURI !== namespace) throw new Error("A namespaced SVG root is required.");
  for (let child = document.firstChild; child; child = child.nextSibling) {
    if (child === element || child.nodeType === 8 || child.nodeType === 3 && !child.nodeValue?.trim() || child.nodeType === 7 && child.nodeName === "xml") continue;
    throw new Error("Unsupported content outside the SVG root.");
  }
  const viewBox = element.getAttribute("viewBox") ?? `0 0 ${svgPixelLength(element.getAttribute("width") ?? "")} ${svgPixelLength(element.getAttribute("height") ?? "")}`;
  const box = viewBox.trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error("SVG requires a valid viewBox with positive dimensions.");
  const ids = new Map<string, SvgNode>();
  const references: Array<{ id: string; attribute: string }> = [];
  let count = 0;
  function read(node: Element, depth: number): SvgNode {
    if (++count > 5000 || depth > 64) throw new Error("SVG is too complex.");
    if (node.namespaceURI !== namespace || !tags.has(node.tagName) || depth > 0 && node.tagName === "svg") throw new Error(`Unsupported SVG element: ${node.tagName}.`);
    const result: SvgNode = { tag: node.tagName, attributes: {}, children: [] };
    for (let index = 0; index < node.attributes.length; index++) {
      const attr = node.attributes.item(index)!;
      if (attr.name !== "style" && !attributes.has(attr.name) || attr.name === "xmlns" && attr.value !== namespace) throw new Error(`Unsupported SVG attribute: ${attr.name}.`);
      if (attr.value.length > 100000) throw new Error("SVG attribute is too long.");
      if (attr.name === "xmlns:xlink") {
        if (attr.value !== xlinkNamespace) throw new Error("Invalid SVG xlink namespace.");
        continue;
      }
      if (attr.name === "xml:space") {
        if (!["preserve", "default"].includes(attr.value)) throw new Error("Invalid SVG xml:space value.");
        continue;
      }
      if (["href", "xlink:href"].includes(attr.name)) {
        if (node.tagName !== "use" || attr.name === "xlink:href" && attr.namespaceURI !== xlinkNamespace || !attr.value.startsWith("#") || !SVG_REGION_ID.test(attr.value.slice(1))) throw new Error("SVG use references must be local IDs.");
        if (result.attributes.href && result.attributes.href !== attr.value) throw new Error("Conflicting SVG use references.");
        result.attributes.href = attr.value;
        continue;
      }
      if (attr.name !== "style") result.attributes[attr.name] = attr.value;
    }
    if (node.hasAttribute("style")) Object.assign(result.attributes, parseSvgStyle(node.getAttribute("style")!));
    for (const [name, value] of Object.entries(result.attributes)) {
      if (["color", "paint-order", "overflow"].includes(name)) {
        result.attributes[name] = parseSvgStyleValue(name, value);
      }
      if (["fill", "stroke", "clip-path", "stop-color", "color"].includes(name)) {
        const keyword = value.toLowerCase();
        if (["none", "inherit", "currentcolor"].includes(keyword)) {
          if (name === "color" && keyword === "none" || name === "clip-path" && keyword === "currentcolor") throw new Error(`Invalid SVG ${name} value.`);
          result.attributes[name] = keyword === "currentcolor" ? "currentColor" : keyword;
          continue;
        }
        if (value.startsWith("url(")) {
          const match = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)$/.exec(value);
          if (!match) throw new Error("SVG paint and clipping references must be local IDs.");
          if (name === "stop-color") throw new Error("SVG gradient stops require literal colors.");
          references.push({ id: match[1], attribute: name });
        } else {
          try { new Color(value); } catch { throw new Error("Unsupported SVG paint value."); }
        }
      }
    }
    if (node.tagName === "use" && !result.attributes.href) throw new Error("SVG use requires a local reference.");
    const id = result.attributes.id;
    if (id) {
      if (!SVG_REGION_ID.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate SVG ID: ${id}.`);
      ids.set(id, result);
    }
    for (let child: Node | null = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) result.children.push(read(child as Element, depth + 1));
      else if (child.nodeType === 8) continue;
      else if (child.nodeType === 3 || child.nodeType === 4) {
        const text = child.nodeValue ?? "";
        if (["title", "desc"].includes(node.tagName)) result.text = (result.text ?? "") + text;
        else if (text.trim()) throw new Error("SVG text must be converted to paths.");
      } else throw new Error("Unsupported SVG XML node.");
    }
    return result;
  }
  const rawRoot = read(element, 0);
  rawRoot.attributes.viewBox = viewBox;
  if (!rawRoot.attributes.color || ["inherit", "currentColor"].includes(rawRoot.attributes.color)) rawRoot.attributes.color = "black";
  for (const { id, attribute } of references) {
    const referenced = ids.get(id);
    if (!referenced || !(attribute === "clip-path" ? referenced.tag === "clipPath" : ["linearGradient", "radialGradient"].includes(referenced.tag))) throw new Error(`Invalid SVG reference: ${id}.`);
  }
  const root = normalizeSvg(rawRoot, ids);
  const eligible: string[] = [];
  const regionPaints: Record<string, SvgPaintChannel> = Object.create(null);
  function inspect(node: SvgNode, inherited?: SvgPaint, hidden = false): Record<SvgPaintChannel, string[]> {
    const paint = inheritSvgPaint(node.attributes, inherited);
    const excluded = hidden || SVG_DEFINITIONS.has(node.tag);
    const paints: Record<SvgPaintChannel, string[]> = { fill: [], stroke: [] };
    for (const child of node.children) {
      const childPaints = inspect(child, paint, excluded);
      for (const channel of ["fill", "stroke"] as const) paints[channel].push(...childPaints[channel]);
    }
    if (!excluded && SVG_SHAPES.has(node.tag)) {
      if (node.tag !== "line" && paint.fill !== "none") paints.fill.push(svgPaintColor(paint.fill, paint));
      if (paint.stroke !== "none") paints.stroke.push(svgPaintColor(paint.stroke, paint));
    }
    const channel = paints.fill.length ? "fill" : "stroke";
    const solid = paints[channel].length && paints[channel].every((color) => !color.startsWith("url(") && new Color(color).alpha === 1);
    const normalized = solid ? paints[channel].map((color) => new Color(color).toString({ format: "hex" })) : [];
    if (!excluded && ids.has(node.attributes.id) && (SVG_SHAPES.has(node.tag) || node.tag === "g") && solid && new Set(normalized).size === 1) {
      eligible.push(node.attributes.id);
      regionPaints[node.attributes.id] = channel;
    }
    return paints;
  }
  inspect(root);
  const regionIds = selectedIds === undefined ? [] : parseRegionIds(selectedIds);
  for (const id of regionIds) if (!eligible.includes(id)) throw new Error(`SVG region "${id}" must identify a visible flat-fill or stroke-only shape or group.`);
  return { kind: "svg", root, width: box[2], height: box[3], regionIds, eligibleRegionIds: eligible, regionPaints };
}
