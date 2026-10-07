import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import Color from "colorjs.io";
import { parseRegionIds, SVG_REGION_ID } from "@/types/color";

export type SvgNode = { tag: string; attributes: Record<string, string>; children: SvgNode[]; text?: string };
export type ColorSvg = { kind: "svg"; root: SvgNode; width: number; height: number; regionIds: string[]; eligibleRegionIds: string[] };

const namespace = "http://www.w3.org/2000/svg";
const shapes = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline"]);
const tags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "defs", "clipPath", "linearGradient", "radialGradient", "stop", "title", "desc"]);
const attributes = new Set(["xmlns", "viewBox", "width", "height", "id", "version", "preserveAspectRatio", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "clip-path", "clip-rule", "clipPathUnits", "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity", "fx", "fy", "fr"]);

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
  const box = (element.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
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
      if (!attributes.has(attr.name) || attr.name === "xmlns" && attr.value !== namespace) throw new Error(`Unsupported SVG attribute: ${attr.name}. Use presentation attributes for fills.`);
      if (attr.value.length > 100000) throw new Error("SVG attribute is too long.");
      if (["fill", "stroke", "clip-path", "stop-color"].includes(attr.name)) {
        if (attr.value.startsWith("url(")) {
          const match = /^url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)$/.exec(attr.value);
          if (!match) throw new Error("SVG paint and clipping references must be local IDs.");
          if (attr.name === "stop-color") throw new Error("SVG gradient stops require literal colors.");
          references.push({ id: match[1], attribute: attr.name });
        } else if (attr.value !== "none" && attr.value !== "inherit") {
          try { new Color(attr.value); } catch { throw new Error("Unsupported SVG paint value."); }
        }
      }
      result.attributes[attr.name] = attr.value;
    }
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
  const root = read(element, 0);
  for (const { id, attribute } of references) {
    const referenced = ids.get(id);
    if (!referenced || !(attribute === "clip-path" ? referenced.tag === "clipPath" : ["linearGradient", "radialGradient"].includes(referenced.tag))) throw new Error(`Invalid SVG reference: ${id}.`);
  }
  const eligible: string[] = [];
  function inspect(node: SvgNode, inheritedFill: string, hidden: boolean): string[] {
    const declared = node.attributes.fill;
    const fill = !declared || declared === "inherit" ? inheritedFill : declared;
    const excluded = hidden || ["defs", "clipPath", "linearGradient", "radialGradient"].includes(node.tag);
    const paints = node.children.flatMap((child) => inspect(child, fill, excluded));
    if (!excluded && shapes.has(node.tag) && fill !== "none") paints.push(fill);
    const solid = paints.length && paints.every((paint) => !paint.startsWith("url("));
    const normalized = solid ? paints.map((paint) => new Color(paint).toString({ format: "hex" })) : [];
    if (!excluded && node.attributes.id && (shapes.has(node.tag) || node.tag === "g") && solid && new Set(normalized).size === 1) eligible.push(node.attributes.id);
    return paints;
  }
  inspect(root, "black", false);
  const regionIds = selectedIds === undefined ? [] : parseRegionIds(selectedIds);
  for (const id of regionIds) if (!eligible.includes(id)) throw new Error(`SVG region "${id}" must identify a visible flat-fill shape or group.`);
  return { kind: "svg", root, width: box[2], height: box[3], regionIds, eligibleRegionIds: eligible };
}
