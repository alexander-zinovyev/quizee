import assert from "node:assert/strict";
import { parseColorSvg } from "./color-svg";
import { parseColorQuestion } from "@/types/color";
import schema from "@/types/quiz.schema.json";
import { validateAgainstQuizSchema } from "@/lib/build/quiz-schema-validator";
import { validateQuizFile } from "@/server/rooms/validation";
import { collectReferencedMedia } from "@/server/rooms/manifest";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#FFFFFF"/><g id="letters" fill="#4285F4"><rect id="left" x="10" y="10" width="20" height="40"/><rect id="right" x="50" y="10" width="20" height="40"/></g></svg>`;
assert.deepEqual(new Set(parseColorSvg(svg).eligibleRegionIds), new Set(["letters", "left", "right"]));
assert.deepEqual(parseColorSvg(svg, ["left", "right"]).regionIds, ["left", "right"]);
assert.throws(() => parseColorSvg(svg, ["missing"]), /visible flat-fill/);
assert.throws(() => parseColorSvg(svg, ["left", "left"]), /unique/);
const styled = parseColorSvg(svg.replace('fill="#4285F4"', 'style="/* exported artwork */ FILL: #4285F4; stroke: rgb(0, 0, 0); stroke-width: 2px; opacity: 0.8;"'), ["letters"]);
assert.deepEqual(styled.root.children[1].attributes, { id: "letters", fill: "#4285F4", stroke: "rgb(0,0,0)", "stroke-width": "2px", opacity: "0.8" });
assert.deepEqual(new Set(styled.eligibleRegionIds), new Set(["letters", "left", "right"]));
for (const attributes of ['fill="red" style="fill:blue"', 'style="fill:blue" fill="red"', 'style="fill:red;fill:blue"', 'style="fill:blue!important;fill:red"', 'style="fill:blue!IMPORTANT;fill:red"', 'style="fill:blue!\\69 mportant;fill:red"', 'style="fill:red!important;fill:blue!important"']) {
  assert.equal(parseColorSvg(svg.replace('fill="#4285F4"', attributes)).root.children[1].attributes.fill, "blue");
}
assert.equal(parseColorSvg(svg.replace('fill="#4285F4"', 'style=""')).root.children[1].attributes.style, undefined);
for (const style of ["fill", "fill:", "fill:red;broken", "fill:red}", "fill:red!foo", "@import url(https://example.com/style.css)", "fill:url(https://example.com/paint)", "fill:url(https://example.com/paint);fill:red", "fill:u\\72l(https://example.com/paint)", "fill:url(data:image/svg+xml,test)", "fill:url(#missing)", "stroke:url(//example.com/paint)", "opacity:url(https://example.com/paint)", "opacity:invalid", "fill:var(--color)", "--color:red", "onclick:alert(1)", "width:20px", "transform:translateX(10px)", "background-image:url(https://example.com/image)"]) {
  assert.throws(() => parseColorSvg(svg.replace('fill="#4285F4"', `style="${style}"`)), /SVG/, style);
}
for (const invalid of [svg.replace('id="right"', 'id="left"'), svg.replace('viewBox="0 0 100 60"', 'viewBox="0 0 -1 60"'), svg.replace('</svg>', '<script>alert(1)</script></svg>'), svg.replace('id="left"', 'id="left" onclick="alert(1)"'), svg.replace('</svg>', '<style>rect{fill:red}</style></svg>'), svg.replace('</svg>', '<image href="https://example.com/image.png"/></svg>'), svg.replace('</svg>', '<foreignObject/></svg>'), svg.replace('</svg>', '<animate/></svg>'), '<!DOCTYPE svg SYSTEM "file:///etc/passwd">' + svg, svg.replace('fill="#FFFFFF"', 'fill="url(https://example.com/color)"'), svg.replace('</svg>', '')]) assert.throws(() => parseColorSvg(invalid));
const question = { image: "logo.svg", regionIds: ["left", "right"], initialColor: "#83C547", targetColor: "#4285F4" };
const pack = [{ type: "color", title: "Vector Colors", scoring: { mode: "closest" }, questions: [question] }];
assert.deepEqual(validateAgainstQuizSchema(pack, schema), []);
const rounds = validateQuizFile(JSON.stringify(pack));
assert.ok(Array.isArray(rounds));
assert.deepEqual([...collectReferencedMedia(rounds)], ["logo.svg"]);
for (const bad of [{ ...question, mask: "mask.png" }, { ...question, regionIds: [] }, { ...question, regionIds: ["left", "left"] }, { ...question, regionIds: "left" }, { ...question, image: "logo.png" }]) {
  assert.throws(() => parseColorQuestion(bad));
  assert.ok(validateAgainstQuizSchema([{ ...pack[0], questions: [bad] }], schema).length);
  assert.equal(typeof validateQuizFile(JSON.stringify([{ ...pack[0], questions: [bad] }])), "string");
}
