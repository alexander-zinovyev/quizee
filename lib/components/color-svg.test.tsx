import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMParser } from "@xmldom/xmldom";
import { parseColorSvg } from "@/lib/media/color-svg";
import { ColorSvgMask } from "./color-svg";
import { ColorImage } from "./color-image";

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><defs><clipPath id="clip"><rect width="100" height="60"/></clipPath><linearGradient id="paint"><stop offset="0" style="stop-color:#FFFFFF;stop-opacity:1"/><stop offset="1" stop-color="#000000"/></linearGradient></defs><rect width="100" height="60" style="fill:URL('#paint');clip-path:url('#clip')"/><g id="letters" style="fill:#4285F4!important"><rect id="left" x="10" y="10" width="20" height="40" style="stroke:#000000;stroke-width:2px"/><rect id="right" x="50" y="10" width="20" height="40"/><path d="M0 0 L10 10" style="fill:none;stroke:#000000"/></g></svg>`;
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
    if (rect.getAttribute("id")?.endsWith("left")) {
      assert.equal(rect.getAttribute("stroke"), "#000000");
      assert.equal(rect.getAttribute("stroke-width"), "2px");
    }
  }
  assert.equal(svg.getElementsByTagName("path").item(0)!.getAttribute("fill"), "none");
  const all = svg.getElementsByTagName("*");
  for (let child = 0; child < all.length; child++) {
    assert.equal(all.item(child)!.hasAttribute("style"), false);
    const id = all.item(child)!.getAttribute("id");
    if (id) { assert.ok(!ids.has(id)); ids.add(id); }
  }
  const clip = svg.getElementsByTagName("clipPath").item(0)!.getAttribute("id");
  const gradient = svg.getElementsByTagName("linearGradient").item(0)!.getAttribute("id");
  const background = rects.item(1)!;
  assert.equal(background.getAttribute("clip-path"), `url(#${clip})`);
  assert.equal(background.getAttribute("fill"), `url(#${gradient})`);
  assert.equal(svg.getElementsByTagName("stop").item(0)!.getAttribute("stop-color"), "#FFFFFF");
}
const original = new DOMParser().parseFromString(renderToStaticMarkup(createElement(ColorImage, { artwork, color: "#FF0000", original: true })), "text/xml");
assert.equal(original.getElementsByTagName("g").item(0)!.getAttribute("fill"), "#4285F4");

const strokeArtwork = parseColorSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><defs><g id="ring"><circle r="9" fill="none" stroke="currentColor"/></g></defs><use id="left" href="#ring" color="red" x="10" y="10"/><use id="right" href="#ring" color="blue" x="30" y="10"/></svg>', ["left"]);
assert.equal(strokeArtwork.regionPaints.left, "stroke");
const strokeDocument = new DOMParser().parseFromString(renderToStaticMarkup(createElement(ColorImage, { artwork: strokeArtwork, color: "#00FF00" })), "text/xml");
const groups = [...strokeDocument.getElementsByTagName("g")];
const left = groups.find((node) => node.getAttribute("id")?.endsWith("-left"))!;
const right = groups.find((node) => node.getAttribute("id")?.endsWith("-right"))!;
assert.equal(left.getElementsByTagName("circle").item(0)!.getAttribute("stroke"), "#00FF00");
assert.equal(left.getElementsByTagName("circle").item(0)!.getAttribute("fill"), "none");
assert.equal(right.getAttribute("color"), "blue");
assert.equal(right.getElementsByTagName("circle").item(0)!.getAttribute("stroke"), "currentColor");
assert.equal(strokeDocument.getElementsByTagName("defs").item(0)!.getElementsByTagName("circle").item(0)!.getAttribute("stroke"), "currentColor");

// The cue shares the recoloring traversal, including selected groups and stroke-only regions.
const maskDocument = new DOMParser().parseFromString(renderToStaticMarkup(createElement("svg", null,
  createElement(ColorSvgMask, { artwork }), createElement(ColorSvgMask, { artwork: strokeArtwork }))), "text/xml");
const maskedLeft = [...maskDocument.getElementsByTagName("rect")].find((node) => node.getAttribute("id")?.endsWith("-left"))!;
assert.equal(maskedLeft.getAttribute("fill"), "white");
assert.equal(maskedLeft.getAttribute("stroke"), "rgba(0, 0, 0, 1)");
assert.equal([...maskDocument.getElementsByTagName("rect")].find((node) => node.getAttribute("id")?.endsWith("-right"))!.getAttribute("fill"), "white");
const maskedStroke = [...maskDocument.getElementsByTagName("g")].find((node) => node.getAttribute("id")?.endsWith("-left"))!.getElementsByTagName("circle").item(0)!;
assert.equal(maskedStroke.getAttribute("fill"), "none");
assert.equal(maskedStroke.getAttribute("stroke"), "white");
assert.equal(maskDocument.getElementsByTagName("path").item(0)!.getAttribute("fill"), "none");
assert.equal(maskDocument.getElementsByTagName("stop").item(0)!.getAttribute("stop-color"), "rgba(0, 0, 0, 1)");
const maskIds = [...maskDocument.getElementsByTagName("*")].map((node) => node.getAttribute("id")).filter(Boolean);
assert.equal(new Set(maskIds).size, maskIds.length);

const translucentArtwork = parseColorSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 40 40"><rect id="selected" x="10" y="20" width="40" height="40" fill="blue"/><rect x="10" y="20" width="20" height="40" fill="rgba(255,0,0,0.5)"/></svg>', ["selected"]);
const translucentMask = new DOMParser().parseFromString(renderToStaticMarkup(createElement("svg", null, createElement(ColorSvgMask, { artwork: translucentArtwork }))), "text/xml");
assert.equal(translucentMask.getElementsByTagName("rect").item(1)!.getAttribute("fill"), "rgba(0, 0, 0, 0.5)");

const inheritedStopArtwork = parseColorSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="gradient" stop-color="rgba(255,0,0,0.5)"><stop offset="0" stop-color="inherit"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect id="selected" width="40" height="40" fill="blue"/><rect width="20" height="40" fill="url(#gradient)"/></svg>', ["selected"]);
const inheritedStopMask = new DOMParser().parseFromString(renderToStaticMarkup(createElement("svg", null, createElement(ColorSvgMask, { artwork: inheritedStopArtwork }))), "text/xml");
assert.equal(inheritedStopMask.getElementsByTagName("stop").item(0)!.getAttribute("stop-color"), "rgba(0, 0, 0, 0.5)");
assert.equal(inheritedStopMask.getElementsByTagName("stop").item(1)!.getAttribute("stop-color"), "rgba(0, 0, 0, 1)");
assert.match(inheritedStopMask.getElementsByTagName("rect").item(1)!.getAttribute("fill")!, /^url\(#color-mask-/);
