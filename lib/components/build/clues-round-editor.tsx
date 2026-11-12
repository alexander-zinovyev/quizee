"use client";

import { parseCluePricing, type ClueMetadata, type CluePricing } from "@/types/clues";
import type { MediaTreeFile } from "./media-tree-shared";
import { createStage, StageEditor, type Stage } from "./stage-editor";
import { SortableBuilderList } from "./sortable-builder-list";

export type BuildCluesQuestion = {
  id: string; collapsed: boolean; generalClue: Stage; answerHint: string; answerStages: Stage[];
  clues: Array<ClueMetadata & { content: Stage }>;
};
function createPaidClue(): BuildCluesQuestion["clues"][number] {
  return { id: createStage().id, category: "", price: 1, content: createStage() };
}
export function createCluesQuestion(): BuildCluesQuestion {
  return { id: createStage().id, collapsed: false, generalClue: createStage(), answerHint: "", answerStages: [createStage()], clues: [createPaidClue()] };
}
export function CluesRoundEditor({ startingCoins, pricing, questions, mediaFiles, onChange }: {
  startingCoins: number; questions: BuildCluesQuestion[]; mediaFiles: MediaTreeFile[];
  pricing?: CluePricing;
  onChange: (startingCoins: number, questions: BuildCluesQuestion[], pricing?: CluePricing) => void;
}) {
  const field = "min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  const addButton = "rounded bg-zinc-900 px-2 py-1 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white";
  const removeButton = "inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200";
  function change(coins: number, next: BuildCluesQuestion[], nextPricing = pricing) { onChange(coins, next, nextPricing); }
  function update(next: BuildCluesQuestion) { change(startingCoins, questions.map((question) => question.id === next.id ? next : question)); }
  return <div className="space-y-3">
    <label className="flex items-center gap-2 text-sm font-semibold">Starting coins
      <input aria-label="Starting coins" type="number" min={1} step={1} value={startingCoins} className={`${field} w-24`}
        onChange={(event) => change(event.target.valueAsNumber, questions)} />
    </label>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold">Pricing mode
        <select aria-label="Pricing mode" value={pricing?.mode ?? "manual"} className={field} onChange={(event) => {
          const next = parseCluePricing({ mode: event.target.value });
          change(startingCoins, next.mode === "manual" ? questions.map((question) => ({ ...question,
            clues: question.clues.map((clue) => ({ ...clue, price: clue.price ?? 1 })) })) : questions, next);
        }}>
          <option value="manual">Manual</option><option value="arithmetic">Arithmetic</option><option value="geometric">Geometric</option>
        </select>
      </label>
      {pricing && pricing.mode !== "manual" ? <>
        <label className="flex items-center gap-2 text-sm font-semibold">Base price (B)
          <input aria-label="Base price" type="number" min={1} step={1} value={pricing.basePrice} className={`${field} w-24`}
            onChange={(event) => change(startingCoins, questions, { ...pricing, basePrice: event.target.valueAsNumber })} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">{pricing.mode === "arithmetic" ? "Increment (N)" : "Multiplier (N)"}
          <input aria-label="Progression" type="number" min={1} step={1} value={pricing.progression} className={`${field} w-24`}
            onChange={(event) => change(startingCoins, questions, { ...pricing, progression: event.target.valueAsNumber })} />
        </label>
      </> : null}
    </div>
    {pricing && pricing.mode !== "manual" ? <p className="text-xs text-zinc-500">Each question starts at B for each team. Each purchase {pricing.mode === "arithmetic" ? "adds N to" : "multiplies by N"} the price of every unopened clue on that question.</p> : null}
    <p className="text-xs text-zinc-500">Each team shares this budget across the round. Correct answers earn one point regardless of coins spent.</p>
    <div className="flex items-center justify-between"><p className="text-sm font-semibold">Questions</p>
      <button type="button" aria-label="Add clues question" onClick={() => change(startingCoins, [...questions, createCluesQuestion()])} className={addButton}>Add question</button>
    </div>
    <SortableBuilderList items={questions} onChange={(next) => change(startingCoins, next)} dragLabel={(index) => `Reorder question ${index + 1}`}>
      {(question, index, handle) => <section aria-label={`Clues question ${index + 1}`} className="space-y-3">
        <div className="flex items-center gap-2">{handle}
          <button type="button" aria-label={`${question.collapsed ? "Expand" : "Collapse"} question ${index + 1}`} onClick={() => update({ ...question, collapsed: !question.collapsed })} className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 dark:bg-zinc-700">{question.collapsed ? "▸" : "▾"}</button>
          <p className="mr-auto text-sm font-semibold">Question {index + 1}</p>
          <button type="button" aria-label={`Remove question ${index + 1}`} onClick={() => change(startingCoins, questions.filter((item) => item.id !== question.id))} className={removeButton}>×</button>
        </div>
        {!question.collapsed ? <>
          <div className="grid min-w-0 grid-cols-1 gap-y-3 lg:grid-cols-2 lg:divide-x lg:divide-zinc-200 dark:lg:divide-zinc-700">
            <section aria-label="General clue" className="min-w-0 space-y-2 lg:pr-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">General clue</h3>
              <StageEditor title="Stage" stage={question.generalClue} mediaFiles={mediaFiles} onChange={(generalClue) => update({ ...question, generalClue })} />
            </section>
            <section aria-label="Answer" className="min-w-0 space-y-2 lg:pl-4">
              <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Answer</h3>
                <button type="button" aria-label="Add answer stage" onClick={() => update({ ...question, answerStages: [...question.answerStages, createStage()] })} className={addButton}>Add stage</button>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">Hint
                <input aria-label="Answer hint" placeholder="Host grading hint" title="Used by the host when grading; not visible to players" value={question.answerHint} className={`${field} flex-1`}
                  onChange={(event) => update({ ...question, answerHint: event.target.value })} />
              </label>
              {question.answerStages.map((stage) => <StageEditor key={stage.id} title="Stage" stage={stage} mediaFiles={mediaFiles}
                onChange={(next) => update({ ...question, answerStages: question.answerStages.map((item) => item.id === stage.id ? next : item) })}
                onRemove={question.answerStages.length > 1 ? () => update({ ...question, answerStages: question.answerStages.filter((item) => item.id !== stage.id) }) : undefined} />)}
            </section>
          </div>
          <section aria-label="Paid clues" className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Paid clues</h3>
              <button type="button" onClick={() => update({ ...question, clues: [...question.clues, createPaidClue()] })} className={addButton}>Add paid clue</button>
            </div>
            <SortableBuilderList items={question.clues} onChange={(clues) => update({ ...question, clues })} dragLabel={(clueIndex) => `Reorder paid clue ${clueIndex + 1}`}>
              {(clue, clueIndex, clueHandle) => {
                const change = (next: typeof clue) => update({ ...question, clues: question.clues.map((item) => item.id === clue.id ? next : item) });
                return <section aria-label={`Paid clue ${clueIndex + 1}`} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">{clueHandle}<p className="mr-auto text-sm font-semibold">Clue {clueIndex + 1}</p>
                    <button type="button" aria-label={`Remove paid clue ${clueIndex + 1}`} onClick={() => update({ ...question, clues: question.clues.filter((item) => item.id !== clue.id) })} className={removeButton}>×</button>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">Category<input aria-label="Clue category" value={clue.category} className={`${field} flex-1`} onChange={(event) => change({ ...clue, category: event.target.value })} /></label>
                    {!pricing || pricing.mode === "manual" ? <label className="flex items-center gap-2 text-sm font-semibold">Coin price<input aria-label="Coin price" type="number" min={1} step={1} value={clue.price ?? 1} className={`${field} w-20`} onChange={(event) => change({ ...clue, price: event.target.valueAsNumber })} /></label> : null}
                  </div>
                  <StageEditor title="Stage" stage={clue.content} mediaFiles={mediaFiles} onChange={(content) => change({ ...clue, content })} />
                </section>;
              }}
            </SortableBuilderList>
          </section>
        </> : null}
      </section>}
    </SortableBuilderList>
  </div>;
}
