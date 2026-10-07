import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMParser } from "@xmldom/xmldom";
import { parseColorSvg } from "@/lib/media/color-svg";
import { ColorImage } from "./color-image";

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><defs><clipPath id="clip"><rect width="100" height="60"/></clipPath><linearGradient id="paint"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#000000"/></linearGradient></defs><rect width="100" height="60" fill="url(#paint)" clip-path="url(#clip)"/><g id="letters" fill="#4285F4"><rect id="left" x="10" y="10" width="20" height="40" stroke="#000000"/><rect id="right" x="50" y="10" width="20" height="40"/><path d="M0 0 L10 10" fill="none" stroke="#000000"/></g></svg>`;
const artwork = parseColorSvg(source, ["letters"]);
const markup = renderToStaticMarkup(createElement("div", null,
  createElement(ColorImage, { artwork, color: "#FF0000" }),
  createElement(ColorImage, { artwork, color: "#00FF00" })));
const document = new DOMParser().parseFromString(markup, "text/xml");
const svgs = document.getElementsByTagName("svg");
const ids = new Set<string>();
for (let index = 0; index < svgs.length; index++) {
  const svg = svgs.item(index)!;
  const rects = svg.getElementsByTagName("rect");
  for (let r = 0; r < rects.length; r++) {
    const rect = rects.item(r)!;
    if (rect.getAttribute("id")?.endsWith("left") || rect.getAttribute("id")?.endsWith("right")) assert.equal(rect.getAttribute("fill"), index === 0 ? "#FF0000" : "#00FF00");
    if (rect.getAttribute("id")?.endsWith("left")) assert.equal(rect.getAttribute("stroke"), "#000000");
  }
  assert.equal(svg.getElementsByTagName("path").item(0)!.getAttribute("fill"), "none");
  const all = svg.getElementsByTagName("*");
  for (let child = 0; child < all.length; child++) {
    const id = all.item(child)!.getAttribute("id");
    if (id) { assert.ok(!ids.has(id)); ids.add(id); }
  }
  const clip = svg.getElementsByTagName("clipPath").item(0)!.getAttribute("id");
  const gradient = svg.getElementsByTagName("linearGradient").item(0)!.getAttribute("id");
  const background = rects.item(1)!;
  assert.equal(background.getAttribute("clip-path"), `url(#${clip})`);
  assert.equal(background.getAttribute("fill"), `url(#${gradient})`);
}
