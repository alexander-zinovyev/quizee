import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptNavigation } from "./prompt-navigation";

function render(type: "text" | "multi-step", page: number, count: number) {
  return renderToStaticMarkup(<PromptNavigation type={type} page={page} count={count} onPrevious={() => {}} onNext={() => {}} />);
}
const first = render("multi-step", 0, 3);
assert.ok(first.includes("Step"));
assert.ok(first.includes('title="Next step"'));
assert.ok(!first.includes("Previous page"));
assert.ok(!first.includes("First page"));
assert.equal((first.match(/<button/g) ?? []).length, 1);
for (const [page, count] of [[2, 3], [0, 1]]) {
  const last = render("multi-step", page, count);
  assert.ok(last.includes("Step"));
  assert.ok(last.includes(`>${page + 1}</span>`));
  assert.ok(!last.includes("<button"));
}
assert.ok(render("text", 0, 3).includes('title="Previous page"'));
assert.ok(render("text", 2, 3).includes('title="First page"'));
assert.equal(render("text", 0, 1), "");
