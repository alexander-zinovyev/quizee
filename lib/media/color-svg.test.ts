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
for (const invalid of [svg.replace('id="right"', 'id="left"'), svg.replace('viewBox="0 0 100 60"', 'viewBox="0 0 -1 60"'), svg.replace('</svg>', '<script>alert(1)</script></svg>'), svg.replace('id="left"', 'id="left" onclick="alert(1)"'), svg.replace('id="left"', 'id="left" style="fill:red"'), svg.replace('</svg>', '<image href="https://example.com/image.png"/></svg>'), svg.replace('</svg>', '<foreignObject/></svg>'), svg.replace('</svg>', '<animate/></svg>'), '<!DOCTYPE svg SYSTEM "file:///etc/passwd">' + svg, svg.replace('fill="#FFFFFF"', 'fill="url(https://example.com/color)"'), svg.replace('</svg>', '')]) assert.throws(() => parseColorSvg(invalid));
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
