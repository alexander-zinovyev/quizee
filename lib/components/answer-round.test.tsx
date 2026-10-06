import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerInputs } from "./answer-round";
import type { TeamAnswer } from "@/lib/answers";

const questions = [{ id: "q1", prompt: "Hidden clue" }, { id: "q2", prompt: "Other hidden clue" }];
const presenting = { round: "r1", question: "q1", promptPage: 0, withAnswer: false };
const saved: TeamAnswer = { answer: "Paris", locked: false, user: "player", attempts: [] };

function render(type: "text" | "multi-step", answers: Record<string, TeamAnswer> = {},
  options: { allowAnswerChanges?: boolean; step?: number; finalizedStep?: number; withAnswer?: boolean; enabled?: boolean } = {}) {
  return renderToStaticMarkup(<AnswerInputs
    type={type} roundId="r1"
    questions={questions.map((question) => ({ ...question, finalizedStep: options.finalizedStep ?? -1 }))}
    presenting={{ ...presenting, promptPage: options.step ?? 0, withAnswer: options.withAnswer ?? false }}
    allowAnswerChanges={options.allowAnswerChanges ?? true}
    answers={answers} pending={{}} enabled={options.enabled ?? true} error={null} onChange={() => {}}
  />);
}
function disabled(html: string) { return (html.match(/<input\b[^>]*>/g) ?? []).map((input) => input.includes('disabled=""')); }
assert.deepEqual(disabled(render("text")), [false, false]);
assert.deepEqual(disabled(render("multi-step")), [false, true]);
for (const type of ["text", "multi-step"] as const) {
  assert.ok(!render(type).includes("Hidden clue"));
  const locked = render(type, { q1: { ...saved, locked: true } });
  assert.deepEqual(disabled(locked), [true, type === "multi-step"]);
  assert.ok(locked.includes('title="Edit answer"'));
  assert.deepEqual(disabled(render(type, {}, { enabled: false })), [true, true]);
}
const committed = { ...saved, attempts: [{ answer: "Paris", step: 0, submittedAt: "now", submittedBy: "player" }] };
const withStep = render("multi-step", { q1: committed }, { step: 1 });
assert.ok(withStep.includes('title="Step"'));
assert.ok(withStep.indexOf('title="Step"') < withStep.indexOf('<input'));
assert.deepEqual(disabled(render("multi-step", { q1: committed }, { step: 1, allowAnswerChanges: false })), [true, true]);
assert.deepEqual(disabled(render("multi-step", { q1: committed }, { step: 1, allowAnswerChanges: true })), [false, true]);
assert.deepEqual(disabled(render("multi-step", {}, { finalizedStep: 0 })), [true, true]);
assert.deepEqual(disabled(render("multi-step", {}, { finalizedStep: 0, step: 1 })), [false, true]);
assert.deepEqual(disabled(render("multi-step", {}, { withAnswer: true })), [true, true]);
