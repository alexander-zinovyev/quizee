import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseColorSvg, type SvgNode } from "./color-svg";

const names = ["harley", "jurassic", "mastercard", "mcdonalds", "olympic", "playstation", "redbull", "slack"];
for (const name of names) {
  const source = readFileSync(`tests/fixtures/color-svg/${name}.svg`, "utf8");
  const artwork = parseColorSvg(source);
  assert.ok(artwork.eligibleRegionIds.length > 0, `${name} needs selectable regions`);
  assert.deepEqual(parseColorSvg(source).eligibleRegionIds, artwork.eligibleRegionIds, `${name} IDs must be deterministic`);
  assert.doesNotThrow(() => parseColorSvg(source, [artwork.eligibleRegionIds[0]]));
  const ids = new Set<string>();
  function inspect(node: SvgNode) {
    assert.notEqual(node.tag, "use");
    assert.equal(node.attributes["xlink:href"], undefined);
    assert.equal(node.attributes.style, undefined);
    if (node.attributes.id) {
      assert.ok(!ids.has(node.attributes.id), `${name} has duplicate IDs`);
      ids.add(node.attributes.id);
    }
    node.children.forEach(inspect);
  }
  inspect(artwork.root);
}

const svg = (body: string, attributes = 'viewBox="0 0 40 20"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
const inferred = parseColorSvg(svg('<path d="M0 0h20v10H0z"/>', 'width="40px" height="20"'));
assert.equal(inferred.root.attributes.viewBox, "0 0 40 20");
assert.deepEqual(inferred.eligibleRegionIds, [], "authors must provide region IDs");
assert.equal(inferred.root.children[0].attributes.id, undefined);
assert.equal(inferred.root.attributes.color, "black", "standalone currentColor must not inherit the app theme");
for (const attributes of ['width="100%" height="20"', 'width="10em" height="20"', 'width="0" height="20"', 'width="40"', 'viewBox="0 0 0 20" width="40" height="20"']) assert.throws(() => parseColorSvg(svg("", attributes)));
assert.deepEqual(parseColorSvg(svg('<path id="named" d="M0 0h20v10H0z"/><path d="M20 0h20v10H20z"/>')).eligibleRegionIds, ["named"]);
assert.equal(parseColorSvg(svg('<path id="__proto__" d="M0 0h20v10H0z"/>'), ["__proto__"]).regionPaints.__proto__, "fill");
const currentColor = parseColorSvg(svg('<g color="red" fill="currentColor"><path id="a" d="M0 0h20v10H0z"/><path id="b" color="blue" d="M20 0h20v10H20z"/></g>'));
assert.ok(currentColor.eligibleRegionIds.includes("a") && currentColor.eligibleRegionIds.includes("b"));
assert.equal(currentColor.eligibleRegionIds.length, 2, "different inherited currentColors must not form a single-color group");
const styles = parseColorSvg(svg('<path id="p" d="M0 0h20v10H0z" style="color:#000;-inkscape-stroke:none;paint-order:stroke fill markers;overflow:visible"/>', 'viewBox="0 0 40 20" xml:space="preserve"'));
assert.equal(styles.root.children[0].attributes["paint-order"], "stroke fill markers");
assert.equal(styles.root.children[0].attributes["-inkscape-stroke"], undefined);
for (const style of ["-inkscape-stroke:url(https://example.com/paint)", "color:url(https://example.com/color)", "paint-order:invalid", "overflow:invalid", "filter:blur(2px)"]) assert.throws(() => parseColorSvg(svg(`<path style="${style}"/>`)));
for (const attribute of ['paint-order="stroke;paint-order:fill"', 'overflow="visible;overflow:hidden"', 'xml:space="invalid"', 'xmlns:xlink="https://example.com/xlink"']) assert.throws(() => parseColorSvg(svg(`<path ${attribute}/>`)));

const referenced = svg('<defs><g id="ring"><circle r="9"/></g></defs><g fill="none" stroke="blue"><use id="left" href="#ring" x="10" y="10" transform="scale(2)"/><use id="right" href="#ring" x="30" y="10" stroke="red"/></g>');
const instances = parseColorSvg(referenced, ["left"]);
assert.equal(instances.regionPaints.left, "stroke");
assert.equal(instances.regionPaints.right, "stroke");
assert.equal(instances.root.children[1].children[0].attributes.transform, "scale(2) translate(10 10)");
for (const body of ['<use href="https://example.com/ring.svg#ring"/>', '<use href="data:image/svg+xml,test"/>', '<use href="#missing"/>', '<use/>', '<use href="#a" id="a"/>', '<g id="a"><use href="#a"/></g>', '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs>', '<clipPath id="c"/><use href="#c"/>', '<g id="a"/><use href="#a" x="10%"/>', '<g id="a"/><g id="b"/><use href="#a" xlink:href="#b" xmlns:xlink="http://www.w3.org/1999/xlink"/>', '<g id="a"/><use href="#a"><path/></use>']) assert.throws(() => parseColorSvg(svg(body)));
let exponential = '<g id="u0"><path d="M0 0h1v1H0z"/></g>';
for (let index = 1; index < 14; index++) exponential += `<g id="u${index}"><use href="#u${index - 1}"/><use href="#u${index - 1}"/></g>`;
assert.throws(() => parseColorSvg(svg(`<defs>${exponential}</defs><use href="#u13"/>`)), /too complex/);
assert.throws(() => parseColorSvg(svg(`<defs><g id="empty"/><use id="described" href="#empty">${"<title>description</title>".repeat(2000)}</use></defs><use href="#described"/><use href="#described"/>`)), /too complex/);

const clipped = parseColorSvg(svg('<g id="template"><defs><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs><path d="M0 0h20v20H0z" clip-path="url(#clip)"/></g><use href="#template"/>'));
const clone = clipped.root.children[1].children[0];
assert.notEqual(clone.children[0].children[0].attributes.id, "clip");
assert.equal(clone.children[1].attributes["clip-path"], `url(#${clone.children[0].children[0].attributes.id})`);
assert.ok(!clipped.eligibleRegionIds.includes(clone.attributes.id), "internal clone IDs are not author-selected regions");
