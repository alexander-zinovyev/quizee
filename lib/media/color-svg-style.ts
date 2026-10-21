import { generate, ident, lexer, parse, walk } from "css-tree";
import { SVG_REGION_ID } from "@/types/color";

export const SVG_STYLE_PROPERTIES = ["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "stop-color", "stop-opacity"] as const;
const properties = new Set<string>(SVG_STYLE_PROPERTIES);

export function parseSvgStyle(source: string): Record<string, string> {
  const ast = parse(source, {
    context: "declarationList",
    onParseError: (error) => { throw new Error(`Invalid SVG inline style: ${error.message}`); },
  });
  if (ast.type !== "DeclarationList") throw new Error("Invalid SVG inline style.");
  const declarations = new Map<string, { value: string; important: boolean }>();
  for (const declaration of ast.children) {
    if (declaration.type !== "Declaration") throw new Error("SVG inline styles must contain only property declarations.");
    const property = ident.decode(declaration.property).toLowerCase();
    if (!properties.has(property)) throw new Error(`Unsupported SVG inline style property: ${property}.`);
    if (typeof declaration.important === "string" && ident.decode(declaration.important).toLowerCase() !== "important") throw new Error("Invalid SVG inline style priority.");
    if (lexer.matchProperty(property, declaration.value).error) throw new Error(`Invalid SVG inline style value for ${property}.`);
    walk(declaration.value, (node) => {
      if (node.type === "Raw") throw new Error(`Invalid SVG inline style value for ${property}.`);
      if (node.type === "Url" && (!["fill", "stroke", "clip-path"].includes(property) || !node.value.startsWith("#") || !SVG_REGION_ID.test(node.value.slice(1)))) {
        throw new Error("SVG paint and clipping references must be local IDs.");
      }
    });
    const value = generate(declaration.value);
    const previous = declarations.get(property);
    // Inline declarations beat attributes; among duplicates, importance wins before order.
    if (!previous?.important || declaration.important) declarations.set(property, { value, important: !!declaration.important });
  }
  return Object.fromEntries([...declarations].map(([property, { value }]) => [property, value]));
}
